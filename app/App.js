// The mobile app: a real browser (WebView, your cookies live here on the
// phone) + a chat to the AI agent. The app connects OUT to the bridge server
// over WS; agent commands arrive there and run inside this WebView.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
const { INJECT } = require('./inject');

// ---- point this at your bridge server: copy config.example.js to config.js ----
const { SERVER, TOKEN } = require('./config');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export default function App() {
  const webref = useRef(null);
  const wsref = useRef(null);
  const [url, setUrl] = useState('https://www.google.com');
  const [urlBar, setUrlBar] = useState('https://www.google.com');
  const [linked, setLinked] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  const addMsg = useCallback((who, text) => {
    setMsgs((m) => [...m, { who, text }]);
    setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 50);
  }, []);

  // ---- bridge link: receive agent commands, run them in the WebView ----
  useEffect(() => {
    let ws, dead = false;
    function connect() {
      ws = new WebSocket(`ws://${SERVER}/ws?t=${TOKEN}`);
      wsref.current = ws;
      ws.onopen = () => setLinked(true);
      ws.onclose = () => { setLinked(false); if (!dead) setTimeout(connect, 2000); };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'cmd') runCmd(m.id, m.cmd, m.args || {});
      };
    }
    connect();
    return () => { dead = true; ws && ws.close(); };
  }, []);

  const reply = (id, ok, r, err) => {
    const ws = wsref.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'result', id, ok, r, err }));
  };

  function runCmd(id, cmd, args) {
    if (cmd === 'goto') {
      const u = String(args.url || '');
      setUrl(u.startsWith('http') ? u : 'https://' + u);
      // give the page a moment to load before the agent's next read
      setTimeout(() => reply(id, true, { url: u }), 3000);
      return;
    }
    if (cmd === 'back') {
      webref.current && webref.current.goBack();
      setTimeout(() => reply(id, true, {}), 1500);
      return;
    }
    // everything else runs as JS inside the page
    const wrapped = `(function(){
      try {
        var r = window.__runCmd(${JSON.stringify(cmd)}, ${JSON.stringify(args)});
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: ${JSON.stringify(id)}, ok: true, r: r }));
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: ${JSON.stringify(id)}, ok: false, err: String(e && e.message || e) }));
      }
    })(); true;`;
    if (!webref.current) return reply(id, false, null, 'webview not ready');
    webref.current.injectJavaScript(wrapped);
    // safety: if the page never posts back (e.g. mid-navigation), the bridge times out
  }

  const onWebMessage = (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.id) reply(m.id, m.ok, m.r, m.err);
  };

  // ---- chat ----
  async function sendChat() {
    const msg = draft.trim();
    if (!msg || busy) return;
    setDraft('');
    addMsg('me', msg);
    setBusy(true);
    addMsg('sys', 'agent is working — watch the browser…');
    try {
      const res = await fetch(`http://${SERVER}/chat?t=${TOKEN}`, { method: 'POST', body: JSON.stringify({ msg }) });
      const j = await res.json();
      addMsg('ai', j.reply);
    } catch (err) {
      addMsg('sys', 'error: ' + err.message);
    }
    setBusy(false);
  }

  function go() {
    let u = urlBar.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) {
      u = u.includes('.') && !u.includes(' ') ? 'https://' + u : 'https://www.google.com/search?q=' + encodeURIComponent(u);
    }
    setUrl(u);
  }

  return (
    <SafeAreaView style={s.app}>
      <StatusBar barStyle="light-content" />
      <View style={s.urlbar}>
        <TouchableOpacity style={s.btn} onPress={() => webref.current && webref.current.goBack()}>
          <Text style={s.btnTxt}>‹</Text>
        </TouchableOpacity>
        <TextInput
          style={s.url} value={urlBar} onChangeText={setUrlBar} onSubmitEditing={go}
          autoCapitalize="none" autoCorrect={false} selectTextOnFocus
        />
        <TouchableOpacity style={s.btn} onPress={go}><Text style={s.btnTxt}>Go</Text></TouchableOpacity>
      </View>

      <WebView
        ref={webref}
        source={{ uri: url }}
        userAgent={UA}
        injectedJavaScript={INJECT}
        onMessage={onWebMessage}
        onNavigationStateChange={(nav) => { if (nav.url) setUrlBar(nav.url); }}
        style={s.web}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.chathead} onPress={() => setChatOpen(!chatOpen)}>
          <Text style={s.chatheadTxt}>
            AI AGENT {busy ? '· working…' : ''} {linked ? '' : '· NOT CONNECTED TO SERVER'}
          </Text>
          <Text style={s.chatheadTxt}>{chatOpen ? '▼' : '▲'}</Text>
        </TouchableOpacity>
        {chatOpen && (
          <ScrollView ref={scrollRef} style={s.msgs}>
            {msgs.map((m, i) => (
              <View key={i} style={[s.m, m.who === 'me' ? s.me : m.who === 'ai' ? s.ai : s.sys]}>
                <Text style={m.who === 'sys' ? s.sysTxt : s.mTxt}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>
        )}
        <View style={s.chatrow}>
          <TextInput
            style={s.chatmsg} value={draft} onChangeText={setDraft}
            placeholder="ask the agent…" placeholderTextColor="#66738f"
            onSubmitEditing={sendChat} onFocus={() => setChatOpen(true)}
          />
          <TouchableOpacity style={[s.send, busy && { opacity: 0.4 }]} onPress={sendChat} disabled={busy}>
            <Text style={s.sendTxt}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#0b0e14' },
  urlbar: { flexDirection: 'row', gap: 6, padding: 6, backgroundColor: '#131826', alignItems: 'center' },
  btn: { backgroundColor: '#1e2638', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnTxt: { color: '#dde3ee', fontSize: 15 },
  url: { flex: 1, backgroundColor: '#0b0e14', color: '#9fb0cc', borderWidth: 1, borderColor: '#232c42', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 13 },
  web: { flex: 1 },
  chathead: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#0e1220', borderTopWidth: 1, borderTopColor: '#1c2438' },
  chatheadTxt: { color: '#7d8db0', fontSize: 12, letterSpacing: 1 },
  msgs: { maxHeight: 260, backgroundColor: '#0e1220', paddingHorizontal: 10 },
  m: { maxWidth: '88%', marginVertical: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  me: { backgroundColor: '#2a4a8a', alignSelf: 'flex-end' },
  ai: { backgroundColor: '#1a2135', alignSelf: 'flex-start' },
  sys: { alignSelf: 'center', backgroundColor: 'transparent' },
  mTxt: { color: '#dde3ee', fontSize: 14 },
  sysTxt: { color: '#66738f', fontSize: 12 },
  chatrow: { flexDirection: 'row', gap: 6, padding: 6, backgroundColor: '#0e1220' },
  chatmsg: { flex: 1, backgroundColor: '#131826', color: '#dde3ee', borderWidth: 1, borderColor: '#232c42', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, fontSize: 15 },
  send: { backgroundColor: '#2a4a8a', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16, justifyContent: 'center' },
  sendTxt: { color: '#fff', fontSize: 15 },
});
