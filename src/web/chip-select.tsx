import { Icon } from './icons.tsx';

// A compact chip that opens the native picker. The transparent select keeps a
// 16px font so iOS does not zoom the page when it is tapped.
export function ChipSelect({ label, value, options, onChange, disabled, icon, className = '' }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean; icon?: string; className?: string }) {
  return <label className={'chip-select ' + className} title={label}>{icon && <Icon name={icon} size={14}/>}<span className="chip-value">{options.find(option => option.value === value)?.label ?? value}</span>
    <select aria-label={label} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
