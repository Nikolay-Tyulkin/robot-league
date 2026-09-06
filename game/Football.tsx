'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Flag, Fullscreen, Gamepad2, HelpCircle, LoaderCircle, Radio, Users, Volume2, VolumeX, X, Zap, Camera, Pause, RotateCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { GameEngine, EngineInfo } from './engine';
import { ROBOT_KINDS, ROBOT_NAMES, isRobotKind, type RobotKind, type SoloOpponent } from './sim';
import { GameSocket, type RoomInfo, type ServerMessage } from './network';
import { TouchControls } from './TouchControls';
import { TouchInput, subscribeTouchLayout, touchLayoutSnapshot, desktopSnapshot, subscribePortrait, portraitSnapshot } from './touch-input';
import { RobotCredits } from './RobotCredits';

export function Football() {
  const host = useRef<HTMLDivElement>(null), engine = useRef<GameEngine | null>(null), socket = useRef<GameSocket | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [kind, setKind] = useState<RobotKind>('watti');
  const [menuPage, setMenuPage] = useState<'home' | 'solo' | 'multiplayer'>('home');
  const [robotsOpen, setRobotsOpen] = useState(false);
  const [opponent, setOpponent] = useState<SoloOpponent>('random');
  const [name, setName] = useState('Player'), [info, setInfo] = useState<EngineInfo | null>(null);
  const [screen, setScreen] = useState<'menu' | 'connecting' | 'queue' | 'room' | 'playing'>('menu');
  const [room, setRoom] = useState<RoomInfo | null>(null), [status, setStatus] = useState(''), [ping, setPing] = useState(0);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false), [help, setHelp] = useState(false), [copied, setCopied] = useState(false);
  const [invite, setInvite] = useState(''), [joinCode, setJoinCode] = useState('');
  const [touch] = useState(() => new TouchInput());
  const touchLayout = useSyncExternalStore(subscribeTouchLayout, touchLayoutSnapshot, desktopSnapshot);
  const portrait = useSyncExternalStore(subscribePortrait, portraitSnapshot, desktopSnapshot);
  const helpPaused = useRef(false);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      const stored = localStorage.getItem('watti.nickname'); if (stored) setName(stored);
      const code = new URLSearchParams(location.search).get('room'); if (code) { setInvite(code); setJoinCode(code); setMenuPage('multiplayer'); }
    });
    void import('./engine').then(({ GameEngine }) => {
      if (disposed || !host.current) return;
      try { engine.current = new GameEngine(host.current, value => setInfo({ ...value }), message => { if (message) setError(`Could not open the arena: ${message}`); else setReady(true); }, touch); }
      catch { setError('This arena needs WebGL. Enable hardware acceleration and reload the page.'); }
    });
    return () => { disposed = true; engine.current?.dispose(); engine.current = null; socket.current?.close(); };
  }, [touch]);
  useEffect(() => {
    const game = engine.current; game?.setControlsBlocked(help || portrait);
    if (portrait && game?.mode === 'solo' && game.state.phase !== 'paused' && game.state.phase !== 'finished') game.pause();
  }, [portrait, help, ready]);
  function changeHelp(open: boolean) {
    setHelp(open); const game = engine.current; game?.setControlsBlocked(open);
    if (open && game?.mode === 'solo' && game.state.phase !== 'paused' && game.state.phase !== 'finished') { helpPaused.current = true; game.pause(); }
    if (!open && helpPaused.current) { helpPaused.current = false; if (game?.mode === 'solo' && game.state.phase === 'paused') game.pause(); }
  }
  function rememberName() { const n = name.trim().slice(0, 20) || 'Player'; setName(n); localStorage.setItem('watti.nickname', n); return n; }
  function solo() { socket.current?.close(); setError(''); engine.current?.startSolo(kind, rememberName(), opponent); setScreen('playing'); setRoom(null); (document.activeElement as HTMLElement)?.blur(); }
  function menu(page: 'home' | 'multiplayer' = 'home') { setMenuPage(page); socket.current?.close(); socket.current = null; engine.current?.menu(); setScreen('menu'); setRoom(null); setError(''); setStatus(''); }
  function online(type: 'queue' | 'create' | 'join') {
    socket.current?.close(); setError(''); setRoom(null); setScreen('connecting');
    const handler = (message: ServerMessage) => {
      if (message.type === 'queued') { setError(''); setScreen('queue'); setStatus('Looking for an opponent…'); }
      if (message.type === 'room') { setError(''); setRoom(message.room); setScreen(prev => prev === 'playing' ? prev : 'room'); setStatus('Room ready'); }
      if (message.type === 'state') {
        setError('');
        if (engine.current?.mode !== 'online') engine.current?.startOnline(message.player);
        engine.current?.snapshot(message.state); setScreen('playing');
      }
      if (message.type === 'info') setStatus(message.message);
      if (message.type === 'error') {
        setError(message.message); setStatus('');
        if (!client.connected || /opponent left|room has expired|match has ended|reconnection window has expired/.test(message.message)) {
          setRoom(null); if (engine.current?.mode !== 'online') setScreen('connecting');
        }
      }
      if (message.type === 'pong') setPing(Date.now() - message.sent);
    };
    const client = new GameSocket(handler, setStatus, setConnected); socket.current = client;
    if (engine.current) engine.current.onInput = input => client.input(input);
    client.connect({ type, kind, name: rememberName(), ...(type === 'join' ? { code: joinCode.trim().toUpperCase() } : {}) });
    (document.activeElement as HTMLElement)?.blur();
  }
  function copyInvite() {
    if (!room) return;
    const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room.code);
    if (!navigator.clipboard) { setStatus(`Room code: ${room.code}`); return; }
    void navigator.clipboard.writeText(url.toString()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => setStatus(`Room code: ${room.code}`));
  }
  const state = info?.state, playing = screen === 'playing', isOnline = info?.mode === 'online';
  const player = state?.players[info?.player ?? 0];
  const minutes = Math.floor((state?.time ?? 180) / 60), seconds = Math.ceil((state?.time ?? 180) % 60);
  const clock = `${minutes.toString().padStart(2,'0')}:${Math.min(59,seconds).toString().padStart(2,'0')}`;
  const finished = playing && state?.phase === 'finished';
  return <main className={`game-shell ${playing ? 'is-playing' : ''}`} onPointerDownCapture={() => engine.current?.sound.unlock()} onKeyDownCapture={() => engine.current?.sound.unlock()}>
    <div ref={host} className="arena-canvas" />
    <div className="screen-grain" aria-hidden="true" />
    <header className="game-header">
      <button className="brand" onClick={() => menu()} aria-label="Robot League main menu"><span className="brand-icon">RL<span>★</span></span><span>ROBOT <em>LEAGUE</em><small>GARAGE FOOTBALL</small></span></button>
      {!playing && <div className="edition"><span className="live-dot" />ARENA 01 <span className="edition-divider">/</span> SMALL ROBOTS. BIG GAME.</div>}
      <div className="header-tools">
        <Button variant="ghost" size="icon" className="tool-button sound-button" aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const value = !muted; setMuted(value); if (engine.current) { engine.current.sound.muted = value; engine.current.sound.unlock(); } }}>{muted ? <VolumeX /> : <Volume2 />}</Button>
        {playing && <Button variant="ghost" size="icon" className="tool-button" aria-label="Change camera" onClick={() => engine.current?.cycleCamera()}><Camera /></Button>}
        {playing && !isOnline && <Button variant="ghost" size="icon" className="tool-button" aria-label={state?.phase === 'paused' ? 'Resume match' : 'Pause'} onClick={() => engine.current?.pause()}><Pause /></Button>}
        <Button variant="ghost" size="icon" className="tool-button" aria-label="Controls and rules" onClick={() => changeHelp(true)}><HelpCircle /></Button>
        <Button variant="ghost" size="icon" className="tool-button fullscreen-button" aria-label="Fullscreen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen?.(); else void document.documentElement.requestFullscreen?.().catch(() => {}); }}><Fullscreen /></Button>
      </div>
    </header>
    {!playing && <div className={`menu-layout mode-${screen === 'menu' ? menuPage : 'room'}`}>
      <section className="menu-panel">
        {screen === 'menu' && menuPage === 'home' ? <>
          <div className="home-heading"><div className="label-tape"><Zap size={15} fill="currentColor" /> WELCOME TO THE GARAGE</div><h1>SMALL BOTS.<br /><span>BIG ATTITUDE.</span></h1><p className="intro">Two robots. One ball. Your league.</p></div>
          <nav className="mode-choices" aria-label="Game modes">
            <Button className="mode-choice primary-mode" onClick={() => setMenuPage('solo')}><Gamepad2 /><span>SINGLE PLAYER<small>YOUR ROBOT. YOUR AI RIVAL.</small></span><ArrowRight /></Button>
            <Button className="mode-choice" onClick={() => setMenuPage('multiplayer')}><Users /><span>MULTIPLAYER<small>QUICK MATCH OR PLAY WITH A FRIEND</small></span><ArrowRight /></Button>
            <Button className="mode-choice" onClick={() => setRobotsOpen(true)}><Zap /><span>MEET THE ROBOTS<small>THE REAL BOTS BEHIND THE GAME</small></span><ArrowUpRight /></Button>
          </nav>
        </> : <>
          <div className="submenu-header"><Button variant="ghost" className="back-button" onClick={() => menu(screen === 'menu' ? 'home' : 'multiplayer')} aria-label={screen === 'menu' ? 'Back to main menu' : 'Back to multiplayer'}><ArrowLeft /> BACK</Button><h2>{screen !== 'menu' ? screen === 'queue' ? 'FINDING A MATCH' : 'MATCH ROOM' : menuPage === 'solo' ? 'SINGLE PLAYER' : 'MULTIPLAYER'}</h2></div>
          {screen === 'menu' && menuPage === 'solo' ? <div className="setup-grid">
            <div className="setup-column"><div className="section-label">YOUR ROBOT</div><RobotPicker kind={kind} onChange={setKind} />
              <div className="nickname-field"><label className="name-label" htmlFor="nickname">YOUR NAME</label><Input id="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={20} className="nick-input" autoComplete="nickname" /></div>
            </div><div className="setup-column launch-column">
              <label className="section-label" htmlFor="solo-opponent">AI OPPONENT</label><Select value={opponent} onValueChange={value => { if (value === 'random' || isRobotKind(value)) setOpponent(value); }}>
                <SelectTrigger id="solo-opponent" className="opponent-select" aria-label="Solo opponent"><SelectValue>{opponent === 'random' ? 'Random robot' : ROBOT_NAMES[opponent]}</SelectValue></SelectTrigger>
                <SelectContent className="opponent-options" alignItemWithTrigger={false}><SelectItem value="random">Random robot</SelectItem>{ROBOT_KINDS.map(robot => <SelectItem key={robot} value={robot}>{ROBOT_NAMES[robot]}</SelectItem>)}</SelectContent>
              </Select><p className="mode-description">3 minutes · First to 5 goals</p>
              <Button className="play-button" onClick={solo} disabled={!ready}><span>LET’S PLAY</span><ArrowRight /></Button><p className="shot-tip"><strong>HOLD SHOOT</strong> for more power.<br />Release to kick.</p>
            </div>
          </div> : screen === 'menu' ? <div className="setup-grid multiplayer-setup">
            <div className="setup-column"><label className="section-label" htmlFor="nickname">YOUR NAME</label><Input id="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={20} className="nick-input" autoComplete="nickname" /><p className="mode-description">Pick your robot inside the room.<br />Both players choose, then get ready.</p>{invite && <p className="invited-room">INVITED TO <strong>{invite}</strong></p>}</div>
            <div className="setup-column launch-column"><Button className="play-button" disabled={!ready} onClick={() => online('queue')}><Radio /><span>QUICK MATCH<small>FIND AN OPPONENT</small></span></Button><Button className="secondary-action" disabled={!ready} onClick={() => online('create')}><Users /><span>CREATE A ROOM<small>PLAY WITH A FRIEND</small></span></Button><div className="join-row"><Input aria-label="Room code" placeholder="ROOM CODE" maxLength={8} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} /><Button variant="ghost" aria-label="Join with a code" disabled={!ready || joinCode.trim().length < 4} onClick={() => online('join')}>JOIN <ArrowRight size={16} /></Button></div></div>
          </div> : room ? <div className="setup-grid room-setup">
            <div className="setup-column"><div className="section-label">YOUR ROBOT</div><RobotPicker disabled={!connected} kind={room.players[room.player]?.kind ?? kind} onChange={robot => { setKind(robot); socket.current?.selectRobot(robot); }} /><output className="mode-description room-selection-hint">{!connected ? status || 'Reconnecting…' : <>Choose your bot, then press Ready.<br />Changing robots clears both ready checks.</>}</output><Button className="play-button" disabled={!connected || room.players.length < 2 || !room.players.every(p => p.connected) || room.players[room.player]?.ready} onClick={() => socket.current?.send({type:'ready'})}><Check /><span>{room.players[room.player]?.ready ? 'YOU’RE READY' : 'READY!'}</span></Button></div>
            <div className="setup-column room-details"><div className="room-code"><small>ROOM CODE</small><strong>{room.code}</strong><Button variant="ghost" aria-label="Copy invitation" onClick={copyInvite}>{copied ? <Check /> : <Copy />}</Button></div>{room.players.map((p,i) => <div className="room-player" key={i}><span className={i === 0 ? 'cyan-dot' : 'orange-dot'} /><span>{p.name}{i === room.player ? ' · YOU' : ''}<small>{ROBOT_NAMES[p.kind].toUpperCase()}</small></span><span>{!p.connected ? 'OFFLINE' : p.ready ? 'READY' : 'CHOOSING'}</span></div>)}{room.players.length < 2 && <p className="waiting">Share the link or code.<br />Waiting for a second player.</p>}</div>
          </div> : <div className="search-status">{!error && <LoaderCircle className="spin" size={32} />}<p>{status || 'Connecting to the garage…'}</p><p className="mode-description">You’ll choose your robot in the room.</p></div>}
        </>}
        {error && <div className="error-message" role="alert">{error}</div>}
        {!ready && !error && <div className="asset-loading"><LoaderCircle size={16} className="spin" /> ASSEMBLING ROBOTS…</div>}
        {screen === 'menu' && menuPage === 'home' && <RobotCredits open={robotsOpen} onOpenChange={setRobotsOpen} showTrigger={false} />}
      </section>
      {screen === 'menu' && menuPage === 'home' && <div className="preview-caption"><span className="live-dot" /> WATTI × MICRODUCK <small>REFEREED BY REACHY MINI</small></div>}
    </div>}

    {playing && state && <>
      <div className="scoreboard">
        <div className="team-score cyan"><small>{state.players[0].name}</small><strong>{ROBOT_NAMES[state.players[0].kind].toUpperCase()}</strong><b>{state.score[0]}</b></div>
        <div className="match-clock"><span>{state.overtime ? 'EXTRA TIME' : isOnline ? 'ONLINE' : 'SOLO MATCH'}</span><strong>{clock}</strong><small>FIRST TO 5</small></div>
        <div className="team-score orange"><b>{state.score[1]}</b><strong>{ROBOT_NAMES[state.players[1].kind].toUpperCase()}</strong><small>{state.players[1].name}</small></div>
      </div>
      {state.phase === 'countdown' && <div className="match-shout countdown"><small>GET READY!</small>{Math.max(1,Math.ceil(state.phaseTime))}</div>}
      {state.phase === 'goal' && <div className="match-shout"><small>{state.players[state.lastScorer ?? 0].name}</small>GOOOAL!</div>}
      {state.phase === 'paused' && <div className="center-card"><Flag size={32} /><h2>{isOnline ? 'WAITING FOR OPPONENT' : 'TIME OUT'}</h2><p>{isOnline ? 'Connection lost. Waiting 15 seconds for a return.' : 'The robots are taking a breather.'}</p>{!isOnline && <Button className="play-button" onClick={() => engine.current?.pause()}>RESUME <ArrowRight /></Button>}<Button className="secondary-action" onClick={() => menu()}>MENU</Button></div>}
      {finished && <div className="center-card result"><div className="label-tape"><Flag size={16} /> FINAL WHISTLE</div><h2>{state.winner === null ? 'A DRAW!' : state.winner === info?.player ? 'YOU WIN!' : 'NEXT ONE IS YOURS!'}</h2><div className="final-score">{state.score[0]}<span>:</span>{state.score[1]}</div><p>{state.winner === null ? 'Sharing the garage glory today.' : `${state.players[state.winner].name} takes the match.`}</p><Button className="play-button" onClick={() => { if (isOnline) { socket.current?.send({type:'rematch'}); setStatus('Rematch request sent'); } else solo(); }}>REMATCH <ArrowRight /></Button>{isOnline && <p className="waiting">{status}</p>}<Button className="secondary-action" onClick={() => menu()}>MENU</Button></div>}
      <div className="player-hud"><div className="hud-name"><Zap size={17} />{ROBOT_NAMES[player?.kind ?? kind].toUpperCase()}<small>{isOnline ? `${ping} MS` : 'YOU'}</small></div><div className="meter"><span style={{width:`${(player?.energy ?? 1)*100}%`}} /></div><small>SPRINT ENERGY</small>{(player?.charge ?? 0) > 0 && <div className="charge-meter"><span style={{width:`${(player?.charge ?? 0)*100}%`}} /><strong>SHOOT {Math.round((player?.charge ?? 0)*100)}%</strong></div>}</div>
      <Button className="exit-match" variant="ghost" onClick={() => menu()}>MENU <X size={15} /></Button>
      {touchLayout && !portrait && !help && state.phase !== 'paused' && !finished && <TouchControls input={touch} charge={player?.charge ?? 0} />}
      {error && <div className="network-error" role="alert">{error}<Button variant="ghost" onClick={() => menu()}>MENU</Button></div>}
    </>}
    <footer className="control-strip"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>SPACE</kbd> HOLD → RELEASE TO SHOOT</span><span><kbd>E</kbd> TAP</span><span><kbd>SHIFT</kbd> SPRINT</span>{playing && <span><kbd>C</kbd> CAMERA</span>}<button onClick={() => changeHelp(true)}>HOW TO PLAY <ArrowUpRight size={14} /></button></footer>
    <aside className="rotate-notice" aria-label="Landscape orientation"><div><span className="rotate-icon"><Smartphone size={48} /><RotateCw size={27} /></span><h2>TURN YOUR PHONE</h2><p>Robot League plays in landscape.<br />Room for the pitch. And both your thumbs.</p></div></aside>
    <Dialog open={help} onOpenChange={changeHelp}><DialogContent className="help-dialog"><DialogHeader><DialogTitle>GARAGE RULES</DialogTitle><DialogDescription>First to five goals wins, or lead the score when three minutes are up.</DialogDescription></DialogHeader><div className="help-list">{touchLayout && <p className="touch-help">On your phone: joystick on the left. Hold and release SHOOT, use TAP for a short hit, or hold RUN to sprint. Camera and pause are at the top.</p>}<p><kbd>WASD / ↑↓←→</kbd> Move and turn towards the goal.</p><p><kbd>SPACE</kbd> Hold to charge and release near the ball. Watti and Reachy head the ball; Microduck kicks it.</p><p><kbd>E</kbd> A short hit with Watti’s base, Microduck’s foot, or Reachy’s head.</p><p><kbd>SHIFT</kbd> Sprinting uses energy. Release to recharge.</p><p><kbd>C / ESC</kbd> Change camera / pause a solo match.</p><p>The ball bounces off the boards. No offsides. A draw adds one minute of sudden death.</p><p className="muted-copy">Share a room link or code to play with a friend. Both players must connect to the same game server.</p></div></DialogContent></Dialog>
  </main>;
}



function RobotPicker({ kind, onChange, disabled = false }: { kind: RobotKind; onChange: (kind: RobotKind) => void; disabled?: boolean }) {
  return <fieldset className="robot-select" aria-label="Choose your robot">{ROBOT_KINDS.map(robot => <Button key={robot} disabled={disabled} aria-pressed={kind === robot} aria-label={`Play as ${ROBOT_NAMES[robot]}`} className={`robot-choice ${robot} ${kind === robot ? 'selected' : ''}`} onClick={() => onChange(robot)}><span className="robot-symbol">{robot === 'watti' ? 'W.' : robot === 'microduck' ? 'µ.' : 'R.'}</span><span>{ROBOT_NAMES[robot].toUpperCase()}</span>{kind === robot && <Check size={16} />}</Button>)}</fieldset>;
}
