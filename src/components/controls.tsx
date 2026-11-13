import { FORMAT, fromSlider, toSlider, type BoolKey, type NumberKey } from '../app/model';
import { useSettings } from '../app/settings-context';
import { Key, SliderField } from './fields';

type NumberSettingProps = { name: NumberKey; label: string; min: number; max: number; step: number; hint?: string };

/** A slider bound to one numeric setting. Scale runs on a log dial. */
export function NumberSetting({ name, label, min, max, step, hint }: NumberSettingProps) {
  const { set, change } = useSettings();
  return (
    <SliderField
      label={label}
      min={min}
      max={max}
      step={step}
      hint={hint}
      value={name === 'scale' ? toSlider(set.scale) : set[name]}
      display={FORMAT[name](set[name])}
      onChange={(v) => change(name, name === 'scale' ? fromSlider(v) : v, true)}
    />
  );
}

/** A toggle key bound to one on/off setting. */
export function BoolSetting({ name, label }: { name: BoolKey; label: string }) {
  const { set, change } = useSettings();
  return <Key label={label} on={set[name]} onChange={(v) => change(name, v)} />;
}
