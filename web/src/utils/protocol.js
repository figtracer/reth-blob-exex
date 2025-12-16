// Protocol constants for blob parameters
// Update these values when BPO2 or future forks activate

// BPO1 (current) blob parameters
export const BLOB_TARGET = 10;
export const BLOB_MAX = 15;

// Each blob is 128KB (131072 bytes) per EIP-4844
export const BLOB_SIZE_BYTES = 131072;

// Gas per blob (EIP-4844)
export const DATA_GAS_PER_BLOB = 131072;

// Regime thresholds (as % of target)
export const REGIME_THRESHOLDS = {
  abundant: 50,    // 0-50% of target
  normal: 90,      // 50-90% of target
  pressured: 120,  // 90-120% of target
  congested: 150,  // 120-150% of target
  // saturated: >150% of target
};

// Classify a block's regime based on blob count
export function classifyRegime(blobCount) {
  const utilization = (blobCount / BLOB_TARGET) * 100;

  if (utilization <= REGIME_THRESHOLDS.abundant) {
    return 'abundant';
  } else if (utilization <= REGIME_THRESHOLDS.normal) {
    return 'normal';
  } else if (utilization <= REGIME_THRESHOLDS.pressured) {
    return 'pressured';
  } else if (utilization <= REGIME_THRESHOLDS.congested) {
    return 'congested';
  } else {
    return 'saturated';
  }
}

// Calculate target utilization (% of target)
export function calculateTargetUtilization(blobCount) {
  return (blobCount / BLOB_TARGET) * 100;
}

// Calculate saturation index (% of max capacity)
export function calculateSaturationIndex(blobCount) {
  return (blobCount / BLOB_MAX) * 100;
}

// Get regime display info (color, label, description)
export function getRegimeInfo(regime) {
  const regimeMap = {
    abundant: {
      label: 'Abundant',
      color: '#22c55e', // green
      bgColor: 'rgba(34, 197, 94, 0.1)',
      description: 'Low demand, prices decreasing',
    },
    normal: {
      label: 'Normal',
      color: '#3b82f6', // blue
      bgColor: 'rgba(59, 130, 246, 0.1)',
      description: 'Moderate demand, stable prices',
    },
    pressured: {
      label: 'Pressured',
      color: '#f59e0b', // amber
      bgColor: 'rgba(245, 158, 11, 0.1)',
      description: 'Near target, prices stabilizing',
    },
    congested: {
      label: 'Congested',
      color: '#f97316', // orange
      bgColor: 'rgba(249, 115, 22, 0.1)',
      description: 'Above target, prices rising',
    },
    saturated: {
      label: 'Saturated',
      color: '#ef4444', // red
      bgColor: 'rgba(239, 68, 68, 0.1)',
      description: 'Near capacity, high prices',
    },
  };

  return regimeMap[regime] || regimeMap.normal;
}

// Get utilization color based on percentage
export function getUtilizationColor(utilization) {
  if (utilization <= 50) return '#22c55e';      // green
  if (utilization <= 90) return '#3b82f6';      // blue
  if (utilization <= 120) return '#f59e0b';     // amber
  if (utilization <= 150) return '#f97316';     // orange
  return '#ef4444';                              // red
}

// Get saturation color based on percentage
export function getSaturationColor(saturation) {
  if (saturation <= 33) return '#22c55e';       // green (0-5 blobs)
  if (saturation <= 66) return '#f59e0b';       // amber (5-10 blobs)
  if (saturation <= 90) return '#f97316';       // orange (10-13.5 blobs)
  return '#ef4444';                              // red (>13.5 blobs)
}
