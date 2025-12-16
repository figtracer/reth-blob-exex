import { useMemo } from 'react';
import { getRegimeInfo } from '../utils/protocol';

function RollingComparison({ data }) {
  if (!data) {
    return (
      <div className="rolling-comparison">
        <div className="comparison-card skeleton">
          <div className="skeleton-title"></div>
          <div className="skeleton-content"></div>
        </div>
      </div>
    );
  }

  const { hour_1, hour_24, baseline_7d, blob_target, blob_max } = data;

  // Calculate percentage changes
  const calculateChange = (current, baseline) => {
    if (!baseline || baseline === 0) return null;
    return ((current - baseline) / baseline) * 100;
  };

  const formatChange = (change) => {
    if (change === null) return '—';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  };

  const getChangeColor = (change, inverted = false) => {
    if (change === null) return 'var(--text-secondary)';
    // For gas price, positive is "bad" (inverted)
    if (inverted) {
      return change > 0 ? '#ef4444' : '#22c55e';
    }
    return change > 0 ? '#22c55e' : '#ef4444';
  };

  const formatGwei = (wei) => {
    if (!wei) return '0';
    const gwei = wei / 1e9;
    if (gwei < 0.001) return gwei.toFixed(6);
    if (gwei < 1) return gwei.toFixed(4);
    return gwei.toFixed(2);
  };

  const periods = [
    { key: 'hour_1', label: 'Last Hour', data: hour_1 },
    { key: 'hour_24', label: 'Last 24 Hours', data: hour_24 },
    { key: 'baseline_7d', label: '7-Day Baseline', data: baseline_7d },
  ];

  // Dominant regime for each period
  const getDominantRegime = (regimeCounts) => {
    if (!regimeCounts) return 'normal';
    const entries = Object.entries(regimeCounts);
    if (entries.length === 0) return 'normal';
    return entries.reduce((a, b) => (a[1] > b[1] ? a : b))[0];
  };

  return (
    <>
      <div className="rolling-comparison">
        <div className="comparison-header">
          <h2 className="section-title">Rolling Comparison</h2>
          <div className="protocol-badge">
            Target: {blob_target} | Max: {blob_max}
          </div>
        </div>

        <div className="comparison-grid">
          {periods.map((period, index) => {
            const isBaseline = period.key === 'baseline_7d';
            const blobsChange = !isBaseline
              ? calculateChange(period.data.avg_blobs_per_block, baseline_7d.avg_blobs_per_block)
              : null;
            const priceChange = !isBaseline
              ? calculateChange(period.data.avg_gas_price, baseline_7d.avg_gas_price)
              : null;
            const dominantRegime = getDominantRegime(period.data.regime_counts);
            const regimeInfo = getRegimeInfo(dominantRegime);

            return (
              <div key={period.key} className={`period-card ${isBaseline ? 'baseline' : ''}`}>
                <div className="period-header">
                  <h3 className="period-label">{period.label}</h3>
                  <span
                    className="regime-badge"
                    style={{
                      backgroundColor: regimeInfo.bgColor,
                      color: regimeInfo.color,
                    }}
                  >
                    {regimeInfo.label}
                  </span>
                </div>

                <div className="metrics-grid">
                  <div className="metric">
                    <span className="metric-label">Avg Blobs/Block</span>
                    <div className="metric-value-row">
                      <span className="metric-value">
                        {period.data.avg_blobs_per_block?.toFixed(2) || '0'}
                      </span>
                      {!isBaseline && (
                        <span
                          className="metric-change"
                          style={{ color: getChangeColor(blobsChange) }}
                        >
                          {formatChange(blobsChange)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="metric">
                    <span className="metric-label">Avg Gas Price</span>
                    <div className="metric-value-row">
                      <span className="metric-value">
                        {formatGwei(period.data.avg_gas_price)} Gwei
                      </span>
                      {!isBaseline && (
                        <span
                          className="metric-change"
                          style={{ color: getChangeColor(priceChange, true) }}
                        >
                          {formatChange(priceChange)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="metric">
                    <span className="metric-label">Utilization</span>
                    <div className="metric-value-row">
                      <span className="metric-value">
                        {period.data.avg_utilization?.toFixed(1) || '0'}%
                      </span>
                      <UtilizationBar value={period.data.avg_utilization || 0} />
                    </div>
                  </div>

                  <div className="metric">
                    <span className="metric-label">Saturation</span>
                    <div className="metric-value-row">
                      <span className="metric-value">
                        {period.data.avg_saturation?.toFixed(1) || '0'}%
                      </span>
                      <SaturationBar value={period.data.avg_saturation || 0} />
                    </div>
                  </div>

                  <div className="metric full-width">
                    <span className="metric-label">Blocks Analyzed</span>
                    <span className="metric-value">{period.data.block_count?.toLocaleString() || '0'}</span>
                  </div>
                </div>

                {/* Regime Distribution */}
                <div className="regime-distribution">
                  <span className="metric-label">Regime Distribution</span>
                  <RegimeBar counts={period.data.regime_counts} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .rolling-comparison {
          margin-bottom: 2rem;
        }

        .comparison-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .section-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .protocol-badge {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          background: var(--bg-secondary);
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          border: 1px solid var(--border-primary);
        }

        .comparison-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
        }

        .period-card {
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          padding: 1.25rem;
          transition: all 0.2s;
        }

        .period-card:hover {
          border-color: var(--border-secondary);
        }

        .period-card.baseline {
          background: var(--bg-secondary);
          border-style: dashed;
        }

        .period-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border-primary);
        }

        .period-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .regime-badge {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .metric.full-width {
          grid-column: span 2;
        }

        .metric-label {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
        }

        .metric-value-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .metric-value {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }

        .metric-change {
          font-size: 0.75rem;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }

        .regime-distribution {
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border-primary);
        }

        .skeleton {
          animation: pulse 2s infinite;
          min-height: 200px;
        }

        .skeleton-title {
          height: 20px;
          background: var(--border-primary);
          border-radius: 4px;
          width: 150px;
          margin-bottom: 1rem;
        }

        .skeleton-content {
          height: 160px;
          background: var(--border-primary);
          border-radius: 8px;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @media (max-width: 1024px) {
          .comparison-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .comparison-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }

          .metrics-grid {
            grid-template-columns: 1fr;
          }

          .metric.full-width {
            grid-column: span 1;
          }
        }
      `}</style>
    </>
  );
}

// Utilization bar component (target-based)
function UtilizationBar({ value }) {
  const getColor = () => {
    if (value <= 50) return '#22c55e';
    if (value <= 90) return '#3b82f6';
    if (value <= 120) return '#f59e0b';
    if (value <= 150) return '#f97316';
    return '#ef4444';
  };

  const cappedValue = Math.min(value, 200); // Cap at 200% for display

  return (
    <div className="utilization-bar-container">
      <div className="utilization-bar">
        <div
          className="utilization-fill"
          style={{
            width: `${Math.min(cappedValue / 2, 100)}%`,
            backgroundColor: getColor(),
          }}
        />
        {/* Target marker at 50% (100% utilization) */}
        <div className="target-marker" title="Target (100%)" />
      </div>
      <style jsx>{`
        .utilization-bar-container {
          flex: 1;
          max-width: 60px;
        }
        .utilization-bar {
          height: 6px;
          background: var(--border-primary);
          border-radius: 3px;
          position: relative;
          overflow: hidden;
        }
        .utilization-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        .target-marker {
          position: absolute;
          top: -2px;
          bottom: -2px;
          left: 50%;
          width: 2px;
          background: var(--text-secondary);
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

// Saturation bar component (max-based)
function SaturationBar({ value }) {
  const getColor = () => {
    if (value <= 33) return '#22c55e';
    if (value <= 66) return '#f59e0b';
    if (value <= 90) return '#f97316';
    return '#ef4444';
  };

  return (
    <div className="saturation-bar-container">
      <div className="saturation-bar">
        <div
          className="saturation-fill"
          style={{
            width: `${Math.min(value, 100)}%`,
            backgroundColor: getColor(),
          }}
        />
      </div>
      <style jsx>{`
        .saturation-bar-container {
          flex: 1;
          max-width: 60px;
        }
        .saturation-bar {
          height: 6px;
          background: var(--border-primary);
          border-radius: 3px;
          overflow: hidden;
        }
        .saturation-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
      `}</style>
    </div>
  );
}

// Regime distribution bar
function RegimeBar({ counts }) {
  if (!counts) return null;

  const regimes = [
    { key: 'abundant', color: '#22c55e' },
    { key: 'normal', color: '#3b82f6' },
    { key: 'pressured', color: '#f59e0b' },
    { key: 'congested', color: '#f97316' },
    { key: 'saturated', color: '#ef4444' },
  ];

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="regime-bar-container">
      <div className="regime-bar">
        {regimes.map(({ key, color }) => {
          const count = counts[key] || 0;
          const percentage = (count / total) * 100;
          if (percentage === 0) return null;
          return (
            <div
              key={key}
              className="regime-segment"
              style={{
                width: `${percentage}%`,
                backgroundColor: color,
              }}
              title={`${key}: ${count} blocks (${percentage.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="regime-legend">
        {regimes.map(({ key, color }) => {
          const count = counts[key] || 0;
          if (count === 0) return null;
          return (
            <span key={key} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: color }} />
              <span className="legend-label">{count}</span>
            </span>
          );
        })}
      </div>
      <style jsx>{`
        .regime-bar-container {
          margin-top: 0.5rem;
        }
        .regime-bar {
          display: flex;
          height: 8px;
          border-radius: 4px;
          overflow: hidden;
          background: var(--border-primary);
        }
        .regime-segment {
          transition: width 0.3s ease;
        }
        .regime-legend {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
          flex-wrap: wrap;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .legend-label {
          font-size: 0.625rem;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

export default RollingComparison;
