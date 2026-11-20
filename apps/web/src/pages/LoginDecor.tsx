/**
 * 登录页装饰层：纯 CSS / SVG 动画（见 styles/login.css），aria-hidden、不接收指针事件。
 * 卡片背后不放运动元素：曲线在卡片下方汇合，浮起的小卡片只在左右两侧。
 */
const FLOWS = [
  'M-20,600 C140,560 260,690 420,660 S600,770 720,770 S1000,660 1200,640 S1380,580 1460,600',
  'M-20,690 C160,660 300,760 480,750 S640,810 720,810 S960,760 1100,740 S1340,700 1460,700',
  'M-20,780 C200,760 360,830 560,830 S880,840 1000,820 S1300,780 1460,790',
];
const STAGES = [
  [200, 604],
  [420, 660],
  [1020, 700],
  [1240, 636],
];
const WAVE_A = 'M0,96 C180,146 360,46 540,96 C720,146 900,46 1080,96 C1260,146 1380,70 1440,86 L1440,190 L0,190 Z';
const WAVE_B = 'M0,112 C200,58 400,160 600,112 C800,64 1000,160 1200,112 C1320,88 1380,100 1440,112 L1440,190 L0,190 Z';

function WaveTrack({ className, d, fill }: { className: string; d: string; fill: string }) {
  return (
    <div className={`login-wave-track ${className}`}>
      {[0, 1].map((i) => (
        <svg key={i} viewBox="0 0 1440 190" preserveAspectRatio="none">
          <path fill={fill} d={d} />
        </svg>
      ))}
    </div>
  );
}

export function LoginDecor() {
  return (
    <div className="login-decor" aria-hidden="true">
      <div className="login-decor-bg" />
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />
      <svg className="login-flow" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        {FLOWS.map((d, i) => (
          <path key={d} className={`p${i + 1}`} d={d} />
        ))}
        {STAGES.map(([cx, cy]) => (
          <circle key={cx} className="stage" cx={cx} cy={cy} r={5} />
        ))}
        <circle className="token t1" r={3.5} />
        <circle className="token t2" r={3} />
        <circle className="token t3" r={2.5} />
      </svg>
      {['r1', 'r2', 'r3', 'r4'].map((r) => (
        <div key={r} className={`login-rise ${r}`}>
          <i />
          <span>
            <b />
            <b />
          </span>
        </div>
      ))}
      <div className="login-wave">
        <WaveTrack className="a" d={WAVE_A} fill="rgba(79, 70, 229, 0.12)" />
        <WaveTrack className="b" d={WAVE_B} fill="rgba(37, 99, 235, 0.10)" />
      </div>
    </div>
  );
}
