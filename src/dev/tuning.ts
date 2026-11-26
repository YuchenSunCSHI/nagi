import './tuning.css';
import { appearance, appearanceDefaults } from '../scene/appearance';
import { camera, defaultPitch } from '../scene/camera';

export function mountTuningPanel(redraw: () => void) {
  const panel = document.createElement('details');
  panel.id = 'water-tuning';
  const title = document.createElement('summary');
  title.textContent = '水面调参';
  panel.append(title);
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = '恢复默认';

  const rows = [
    { name: 'horizon', label: '天际线位置', min: 15, max: 41, step: 0.1,
      get: () => (1 - camera.pitch / camera.verticalScale) * 50,
      set: (percent: number) => { camera.pitch = camera.verticalScale * (1 - percent / 50); },
      format: (percent: number) => `${percent.toFixed(1)}%` },
    ...([
      ['skyBlue', '天空蓝度（白天）', 0.7, 1.45],
      ['distantTransition', '远水过渡（白天）', 0.55, 1.55],
      ['reflection', '反光强度', 0.55, 1.45],
      ['daySparkle', '波光增强（白天）', 0, 2]
    ] as const).map(([key, label, min, max]) => ({
      name: key, label, min, max, step: 0.01,
      get: () => appearance[key],
      set: (value: number) => { appearance[key] = value; },
      format: (value: number) => `${Math.round(value * 100)}%`
    }))
  ];
  const sync = rows.map(row => {
    const label = document.createElement('label');
    label.textContent = row.label;
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.id = `water-tune-${row.name}`;
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    label.htmlFor = input.id;
    const output = document.createElement('output');
    output.htmlFor.add(input.id);
    const updateReadout = () => {
      output.value = row.format(row.get());
      input.setAttribute('aria-valuetext', output.value);
    };
    input.addEventListener('input', () => {
      row.set(input.valueAsNumber);
      updateReadout();
      redraw();
    });
    label.append(input, output);
    wrap.append(label);
    panel.append(wrap);
    return () => {
      input.value = String(row.get());
      updateReadout();
    };
  });
  sync.forEach(update => update());
  refresh.addEventListener('click', () => {
    camera.pitch = defaultPitch;
    Object.assign(appearance, appearanceDefaults);
    sync.forEach(update => update());
    redraw();
  });
  panel.append(refresh);
  document.body.append(panel);
}
