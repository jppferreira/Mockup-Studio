import { memo } from 'react';
import { DEVICE_COLORS, type DeviceColor } from '../types';

type Props = {
  ariaLabel: string;
  color: DeviceColor;
  clayMode: boolean;
  onPick: (color: DeviceColor) => void;
};

function FinishDotsImpl({ ariaLabel, color, clayMode, onPick }: Props) {
  return (
    <div className="device-finish-grid" role="group" aria-label={ariaLabel}>
      {DEVICE_COLORS.map((swatch) => {
        const selected = color === swatch.id || (swatch.id === 'clay' && clayMode);
        return (
          <button
            key={swatch.id}
            type="button"
            className={`device-finish-swatch ${selected ? 'selected' : ''}`}
            title={swatch.label}
            aria-label={swatch.label}
            aria-pressed={selected}
            onClick={() => onPick(swatch.id)}
          >
            <span style={{ background: swatch.hex }} />
          </button>
        );
      })}
    </div>
  );
}

const FinishDots = memo(FinishDotsImpl);
export default FinishDots;
