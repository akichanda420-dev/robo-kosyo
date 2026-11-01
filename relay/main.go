// robo-relay: ロボ工廠のLAN対戦（Hamachi など）用の中継サーバー。
// ホストのPCで動き、ホスト自身とゲストのゲームが WebSocket でつなぐ。
// 部屋ごとに「参加者と各自の presence（状態）」を持ち、変化があるたびに部屋の全員へ配る。
// 対戦の計算は両方のゲームが同じシードで行うので、ここは状態を配るだけ。
//
//	robo-relay [-port 48800] [-idle 20s]
//
// ホスト側（127.0.0.1 からの接続）が一度つないだあと、idle の間だれも
// ローカルからつないでいなければ自動で終了する（ゲームを閉じたら止まる）。
package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const protoVer = 1

type peerInfo struct {
	Peer     string          `json:"peer"`
	By       string          `json:"by"`
	Name     string          `json:"name"`
	Presence json.RawMessage `json:"presence"`
}

type client struct {
	conn  *websocket.Conn
	out   chan []byte
	peer  string
	by    string
	name  string
	local bool
	rooms map[string]json.RawMessage // 部屋名 → presence
}

type hub struct {
	mu        sync.Mutex
	clients   map[*client]bool
	hostVer   string
	lastLocal time.Time
	everLocal bool
}

var h = &hub{clients: map[*client]bool{}}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func send(c *client, v any) {
	b, _ := json.Marshal(v)
	select {
	case c.out <- b:
	default: // 詰まっている相手は切る
		c.conn.Close()
	}
}

// 部屋の参加者一覧を全員へ（mu を持った状態で呼ぶ）
func broadcastRoom(room string) {
	var list []peerInfo
	var members []*client
	for c := range h.clients {
		if p, ok := c.rooms[room]; ok {
			list = append(list, peerInfo{c.peer, c.by, c.name, p})
			members = append(members, c)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Peer < list[j].Peer })
	if list == nil {
		list = []peerInfo{}
	}
	for _, c := range members {
		send(c, map[string]any{"t": "room", "r": room, "peers": list})
	}
}

func lanAddrs() []string {
	var hamachi, other []string
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP.To4() == nil {
				continue
			}
			ip := ipn.IP.String()
			// Hamachi は 25.x.x.x（古い環境では 5.x.x.x）を使う
			if strings.HasPrefix(ip, "25.") || strings.HasPrefix(ip, "5.") || strings.Contains(strings.ToLower(i.Name), "hamachi") {
				hamachi = append(hamachi, ip)
			} else {
				other = append(other, ip)
			}
		}
	}
	return append(hamachi, other...)
}

func isLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	c := &client{conn: conn, out: make(chan []byte, 256), local: isLoopback(r.RemoteAddr), rooms: map[string]json.RawMessage{}}

	go func() { // 書き込み
		ping := time.NewTicker(15 * time.Second)
		defer ping.Stop()
		for {
			select {
			case b, ok := <-c.out:
				if !ok {
					return
				}
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if conn.WriteMessage(websocket.TextMessage, b) != nil {
					conn.Close()
					return
				}
			case <-ping.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if conn.WriteMessage(websocket.PingMessage, nil) != nil {
					conn.Close()
					return
				}
			}
		}
	}()

	conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { conn.SetReadDeadline(time.Now().Add(45 * time.Second)); return nil })

	hello := false
	defer func() {
		h.mu.Lock()
		if h.clients[c] {
			delete(h.clients, c)
			for room := range c.rooms {
				broadcastRoom(room)
			}
			if c.local {
				h.lastLocal = time.Now()
			}
			log.Printf("切断: %s (%s)", c.name, r.RemoteAddr)
		}
		h.mu.Unlock()
		close(c.out)
		conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(45 * time.Second))
		var m struct {
			T    string          `json:"t"`
			Peer string          `json:"peer"`
			By   string          `json:"by"`
			Name string          `json:"name"`
			Ver  string          `json:"ver"`
			R    string          `json:"r"`
			P    json.RawMessage `json:"p"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if !hello {
			if m.T != "hello" || m.Peer == "" {
				return
			}
			h.mu.Lock()
			if c.local && h.hostVer == "" {
				h.hostVer = m.Ver
			}
			if h.hostVer != "" && m.Ver != h.hostVer {
				hv := h.hostVer
				h.mu.Unlock()
				send(c, map[string]any{"t": "reject", "why": "ver", "hostVer": hv})
				time.Sleep(300 * time.Millisecond)
				return
			}
			// 同じ peer が再接続してきたら古い接続を外す
			for o := range h.clients {
				if o.peer == m.Peer {
					delete(h.clients, o)
					o.conn.Close()
					for room := range o.rooms {
						broadcastRoom(room)
					}
				}
			}
			c.peer, c.by, c.name = m.Peer, m.By, trim(m.Name, 24)
			h.clients[c] = true
			if c.local {
				h.everLocal = true
			}
			send(c, map[string]any{"t": "welcome", "proto": protoVer, "hostVer": h.hostVer, "addrs": lanAddrs(), "local": c.local})
			h.mu.Unlock()
			hello = true
			log.Printf("接続: %s (%s)", c.name, r.RemoteAddr)
			continue
		}
		h.mu.Lock()
		switch m.T {
		case "join", "pres":
			if m.R == "" || len(m.R) > 80 {
				break
			}
			p := m.P
			if len(p) == 0 || string(p) == "null" {
				p = json.RawMessage("{}")
			}
			c.rooms[m.R] = p
			broadcastRoom(m.R)
		case "leave":
			if _, ok := c.rooms[m.R]; ok {
				delete(c.rooms, m.R)
				broadcastRoom(m.R)
			}
		}
		h.mu.Unlock()
	}
}

func trim(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		r = r[:n]
	}
	if len(r) == 0 {
		return "プレイヤー"
	}
	return string(r)
}

func main() {
	port := flag.String("port", "48800", "待ち受けるポート")
	idle := flag.Duration("idle", 20*time.Second, "ホストのゲームが閉じてから終了するまでの時間（0で無効）")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", serveWS)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("robo-relay: ロボ工廠のLAN対戦サーバーです\n"))
	})

	ln, err := net.Listen("tcp", ":"+*port)
	if err != nil {
		log.Fatalf("ポート %s を開けません: %v", *port, err)
	}
	log.Printf("待ち受け開始 :%s  アドレス: %v", *port, lanAddrs())

	if *idle > 0 {
		start := time.Now()
		go func() {
			for range time.Tick(2 * time.Second) {
				h.mu.Lock()
				anyLocal := false
				for c := range h.clients {
					if c.local {
						anyLocal = true
					}
				}
				var quiet bool
				if anyLocal {
					quiet = false
				} else if h.everLocal {
					quiet = time.Since(h.lastLocal) > *idle
				} else {
					quiet = time.Since(start) > *idle*3 // 起動したのにだれも来ない
				}
				h.mu.Unlock()
				if quiet {
					log.Printf("ホストのゲームが閉じたので終了します")
					ln.Close()
					return
				}
			}
		}()
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := srv.Serve(ln); err != nil && !strings.Contains(err.Error(), "closed") {
		log.Fatal(err)
	}
}
