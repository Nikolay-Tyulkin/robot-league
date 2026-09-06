'use client';
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Footprints, Zap } from 'lucide-react';
import { stickVector, type TouchInput, type TouchAction } from './touch-input';

export function TouchControls({ input, charge }: { input: TouchInput; charge: number }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState({ charge: false, sprint: false, tap: false });
  const keys = useRef(new Set<string>());
  const sync = () => setHeld({ charge: input.held('charge'), sprint: input.held('sprint'), tap: input.held('tap') });
  function updateKeys() {
    if (!keys.current.size) { input.release(-1); setKnob({ x: 0, y: 0 }); return; }
    if (input.moveOwner === null) input.beginMove(-1);
    if (input.moveOwner !== -1) return;
    const x = Number(keys.current.has('ArrowRight')) - Number(keys.current.has('ArrowLeft'));
    const z = Number(keys.current.has('ArrowDown')) - Number(keys.current.has('ArrowUp'));
    input.move(-1, x, z); setKnob({ x: x * 28, y: z * 28 });
  }
  useEffect(() => {
    const reset = () => { input.clear(); keys.current.clear(); setKnob({ x: 0, y: 0 }); setHeld({ charge: false, sprint: false, tap: false }); };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('blur', reset); window.addEventListener('pagehide', reset);
    window.addEventListener('orientationchange', reset); document.addEventListener('visibilitychange', visibility);
    return () => {
      input.clear(); window.removeEventListener('blur', reset); window.removeEventListener('pagehide', reset);
      window.removeEventListener('orientationchange', reset); document.removeEventListener('visibilitychange', visibility);
    };
  }, [input]);
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (input.moveOwner !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect(), radius = rect.width * .32;
    const value = stickVector(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2, radius);
    input.move(e.pointerId, value.x, value.z); setKnob({ x: value.knobX, y: value.knobY });
  }
  function release(e: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    if (input.moveOwner === e.pointerId) setKnob({ x: 0, y: 0 });
    input.release(e.pointerId, cancelled); sync();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const actionProps = (action: TouchAction) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return; e.preventDefault();
      if (input.beginAction(e.pointerId, action)) { e.currentTarget.setPointerCapture(e.pointerId); sync(); }
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => release(e, false),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => release(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) => { input.release(e.pointerId, true); sync(); },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault(); if (e.repeat) return;
      input.beginAction(action === 'charge' ? -10 : action === 'sprint' ? -11 : -12, action); sync();
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault(); input.release(action === 'charge' ? -10 : action === 'sprint' ? -11 : -12); sync();
    },
    onBlur: () => { input.release(action === 'charge' ? -10 : action === 'sprint' ? -11 : -12, true); sync(); },
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => { if (e.detail === 0) { input.pulse(action); sync(); } },
  });
  return <div className="touch-controls" aria-label="Touch controls">
    <button type="button" className="touch-stick" aria-label="Movement joystick" aria-describedby="stick-hint"
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); if (input.beginMove(e.pointerId)) { e.currentTarget.setPointerCapture(e.pointerId); move(e); } }}
      onPointerMove={move} onPointerUp={e => release(e, false)} onPointerCancel={e => release(e, true)}
      onLostPointerCapture={e => { if (input.moveOwner === e.pointerId) { input.release(e.pointerId, true); setKnob({ x: 0, y: 0 }); } }}
      onKeyDown={e => {
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
        e.preventDefault(); keys.current.add(e.key); updateKeys();
      }} onKeyUp={e => { if (keys.current.delete(e.key)) updateKeys(); }}
      onBlur={() => { keys.current.clear(); if (input.moveOwner === -1) { input.release(-1); setKnob({ x: 0, y: 0 }); } }}>
      <span className="stick-cross" aria-hidden="true" />
      <span className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true"><ArrowUp size={19} /></span>
      <span className="stick-label" id="stick-hint">MOVE</span>
    </button>
    <div className="touch-actions" onContextMenu={e => e.preventDefault()}>
      <button type="button" className="touch-action touch-sprint" aria-label="Sprint — hold" aria-pressed={held.sprint} {...actionProps('sprint')}><Zap size={20} /><span>RUN</span></button>
      <button type="button" className="touch-action touch-tap" aria-label="Short hit" aria-pressed={held.tap} {...actionProps('tap')}><Footprints size={20} /><span>TAP</span></button>
      <p className={`shot-coach ${held.charge ? 'is-charging' : ''}`} id="shot-hint">{held.charge ? <>RELEASE TO SHOOT <strong>{Math.round(charge * 100)}% POWER</strong></> : <>HOLD FOR POWER<strong>RELEASE TO SHOOT</strong></>}</p>
      <button type="button" className="touch-action touch-shot" aria-label="Shoot — hold for power, release to kick" aria-describedby="shot-hint" aria-pressed={held.charge} {...actionProps('charge')}>
        <span className="shot-power" style={{ height: `${Math.round(charge * 100)}%` }} aria-hidden="true" />
        <span className="shot-label">{held.charge ? 'RELEASE' : 'SHOOT'}<small>{held.charge ? `${Math.round(charge * 100)}% POWER` : 'HOLD TO CHARGE'}</small></span>
      </button>
    </div>
  </div>;
}

