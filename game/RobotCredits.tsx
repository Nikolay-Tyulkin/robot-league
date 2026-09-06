'use client';
import { useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { creator, robots } from './credits';

export function RobotCredits({ open: controlledOpen, onOpenChange, showTrigger = true }: { open?: boolean; onOpenChange?: (open: boolean) => void; showTrigger?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const title = useRef<HTMLHeadingElement>(null);
  return <>
    <aside className="creator-card" aria-label="Creator and robot credits">
      {creator.name && <p className="creator-name"><span>A GAME BY</span> <strong>{creator.name}</strong></p>}
      <nav className="creator-links" aria-label="Creator links">
        {creator.github && <a href={creator.github} target="_blank" rel="noopener noreferrer">GitHub <ArrowUpRight size={13} /></a>}
        {creator.instagram && <a href={creator.instagram} target="_blank" rel="noopener noreferrer">Instagram <ArrowUpRight size={13} /></a>}
        {creator.x && <a href={creator.x} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">X <ArrowUpRight size={13} /></a>}
        {showTrigger && <Button variant="ghost" onClick={() => setOpen(true)}>MEET THE ROBOTS <ArrowUpRight size={14} /></Button>}
      </nav>
    </aside>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="help-dialog robots-dialog" initialFocus={title}><DialogHeader><DialogTitle ref={title} tabIndex={-1}>MEET THE ROBOTS</DialogTitle><DialogDescription>Three real robots. One very unofficial football league.</DialogDescription></DialogHeader>
        <div className="robot-credits-list">
          {robots.map(robot => <article className="robot-credit" key={robot.name}>
            <span className="credit-symbol" aria-hidden="true">{robot.symbol}</span>
            <div><small>{robot.role}</small><h3>{robot.name}</h3><p>{robot.description}</p>
              <div className="repository-links">{robot.repository ? <a href={robot.repository} target="_blank" rel="noopener noreferrer" aria-label={`${robot.name} GitHub repository`}>{robot.repositoryLabel ?? 'GitHub repository'} <ArrowUpRight size={14} /></a> : <span>Personal robot</span>}
                <a href={`/models/${robot.name === 'Reachy Mini' ? 'reachy' : robot.name.toLowerCase()}/NOTICE.md`} target="_blank" rel="noopener noreferrer">License notice <ArrowUpRight size={14} /></a>{robot.modelRepository && <a href={robot.modelRepository} target="_blank" rel="noopener noreferrer">Model source <ArrowUpRight size={14} /></a>}</div>
            </div>
          </article>)}
        </div>
        <p className="robot-attribution">Models retain separate licenses: Watti — CC BY-NC 4.0. Pollen Robotics models — BY-NC-SA, version unspecified upstream. See each model’s license notice.</p>
      </DialogContent>
    </Dialog>
  </>;
}
