import { isDimmable, withDefaults } from '../../devices/capabilities';
import { formatRgb, kelvinToRgb, parseRgb, rgbToCss } from '../../devices/color';
import { attr, hexToRgb, isOn, num, rgbToHex } from './attrs';
import { ColorInput, Slider, Toggle } from './primitives';
import type { ControlProps } from './types';

/** Luz: encendido, brillo en %, temperatura de color y color según capacidades. */
export function LightControl({ definition, state, onService }: ControlProps) {
  const caps = withDefaults('light', definition.capabilities);
  const modes = caps.colorModes ?? [];
  const on = isOn(state);
  const brightness = num(attr(state, 'brightness'), on ? 255 : 0);
  const pct = on ? Math.max(1, Math.round((brightness / 255) * 100)) : 0;
  const minK = caps.minKelvin ?? 2000;
  const maxK = caps.maxKelvin ?? 6500;
  const kelvin = num(attr(state, 'color_temp_kelvin'), Math.round((minK + maxK) / 2));
  const rgb = parseRgb(attr(state, 'rgb_color'));
  const gradient = `linear-gradient(to right, ${rgbToCss(kelvinToRgb(minK))}, ${rgbToCss(kelvinToRgb(maxK))})`;

  return (
    <div className="flex flex-col gap-2">
      <Toggle label="Encender o apagar" checked={on} onChange={(v) => onService(v ? 'turn_on' : 'turn_off')} />
      {isDimmable(caps) && (
        <Slider
          label="Brillo"
          value={pct}
          min={0}
          max={100}
          format={(v) => `${v} %`}
          onCommit={(v) => onService(v === 0 ? 'turn_off' : 'turn_on', v === 0 ? undefined : { brightness_pct: v })}
        />
      )}
      {modes.includes('color_temp') && (
        <Slider
          label="Temperatura de color"
          value={kelvin}
          min={minK}
          max={maxK}
          step={100}
          format={(v) => `${v} K`}
          trackStyle={gradient}
          onCommit={(v) => onService('turn_on', { color_temp_kelvin: v })}
        />
      )}
      {modes.includes('rgb') && (
        <ColorInput value={rgb ? rgbToHex(rgb) : '#ffffff'} onCommit={(hex) => onService('turn_on', { rgb_color: formatRgb(hexToRgb(hex)) })} />
      )}
    </div>
  );
}
