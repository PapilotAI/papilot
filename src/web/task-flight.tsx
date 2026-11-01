import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.tsx';

export interface TaskFlightData {
  id: string;
  title: string;
  source: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

// The confirmed task travels from the composer to its reserved place in the
// list. A collapsed sidebar receives it at the task-list button instead.
export function TaskFlight({ task, sidebarShown, onArrive }: { task: TaskFlightData; sidebarShown: boolean; onArrive: (task: TaskFlightData) => void }) {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = card.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (sidebarShown) document.querySelector('.task-list')?.scrollTo({ top: 0, behavior: 'instant' });
    const target = sidebarShown
      ? document.querySelector<HTMLElement>(`.task-row[data-task="${CSS.escape(task.id)}"]`)
      : [...document.querySelectorAll<HTMLElement>('.sidebar-toggle')].find(button => button.getBoundingClientRect().width > 0);
    if (!element || !target || reduced.matches) { onArrive(task); return; }
    const destination = target.getBoundingClientRect(), source = task.source;
    if (!destination.width || !source.width) { onArrive(task); return; }
    const width = Math.min(source.width, 360), height = 64;
    element.style.width = `${width}px`;
    const start = { x: source.left + source.width / 2 - width / 2, y: source.top + Math.min(source.height / 2, 64) - height / 2 };
    const end = { x: destination.left, y: destination.top };
    const scaleX = destination.width / width, scaleY = destination.height / height;
    const arc = Math.min(150, Math.abs(end.x - start.x) * .16 + 40);
    const frames = [0, .12, .35, .65, .85, 1].map(progress => {
      const travel = Math.max(0, (progress - .12) / .88);
      const x = start.x + (end.x - start.x) * travel;
      const y = Math.max(8, start.y + (end.y - start.y) * travel - Math.sin(progress * Math.PI) * arc);
      const scale = travel * travel;
      return {
        offset: progress,
        transform: `translate(${x}px, ${y}px) rotate(${-5 * Math.sin(progress * Math.PI)}deg) scale(${1 + (scaleX - 1) * scale}, ${1 + (scaleY - 1) * scale})`,
        opacity: sidebarShown ? 1 : 1 - Math.pow(travel, 5),
      };
    });
    let active = true;
    const finish = () => { if (active) { active = false; onArrive(task); } };
    const animation = element.animate(frames, { duration: 1100, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    // Resizing or changing motion preferences must never leave a hidden row.
    window.addEventListener('resize', finish);
    reduced.addEventListener('change', finish);
    void animation.finished.then(finish, () => {});
    return () => {
      active = false; animation.cancel();
      window.removeEventListener('resize', finish);
      reduced.removeEventListener('change', finish);
    };
  }, [task, sidebarShown, onArrive]);
  return createPortal(<div ref={card} className="task-flight" aria-hidden="true"><span className="task-flight-icon"><Icon name="paper" size={19}/></span><span className="task-flight-title">{task.title}</span><Icon name="arrowUp" size={17}/></div>, document.body);
}
