import { BadRequestException } from '@nestjs/common';

export const ROBOT_HARDWARE_MODELS = ['MINI_ELF', 'ELF', 'NANO', 'S5'] as const;
export type RobotHardwareModel = (typeof ROBOT_HARDWARE_MODELS)[number];

export const ROBOT_HARDWARE_CAPABILITIES = [
  'camera',
  'microphone',
  'speaker',
  'touchDisplay',
  'videoPlayback',
  'speechRecognition',
  'autonomousNavigation',
  'armMotion',
] as const;
export type RobotHardwareCapability = (typeof ROBOT_HARDWARE_CAPABILITIES)[number];

type HardwareProfileInput = {
  model?: string;
  manufacturer?: string;
  androidApiLevel?: number;
  abi?: string;
  display?: {
    width?: number;
    height?: number;
  };
  capabilities?: Record<string, unknown>;
};

type HardwarePolicy = {
  label: string;
  androidApiLevel: number;
  abi: string;
  display: {
    width: number;
    height: number;
  };
  capabilities: Record<RobotHardwareCapability, boolean>;
};

const DEFAULT_CAPABILITIES: Record<RobotHardwareCapability, boolean> = {
  camera: true,
  microphone: true,
  speaker: true,
  touchDisplay: true,
  videoPlayback: true,
  speechRecognition: true,
  autonomousNavigation: false,
  armMotion: false,
};

const SAFETY_CONTROLLED_CAPABILITIES = new Set<RobotHardwareCapability>(['autonomousNavigation', 'armMotion']);

const HARDWARE_POLICIES: Record<RobotHardwareModel, HardwarePolicy> = {
  MINI_ELF: {
    label: 'Mini ELF',
    androidApiLevel: 25,
    abi: 'arm64-v8a',
    display: { width: 1920, height: 1200 },
    capabilities: DEFAULT_CAPABILITIES,
  },
  ELF: {
    label: 'ELF',
    androidApiLevel: 23,
    abi: 'armeabi-v7a',
    display: { width: 1920, height: 1200 },
    capabilities: DEFAULT_CAPABILITIES,
  },
  NANO: {
    label: 'Nano',
    androidApiLevel: 23,
    abi: 'armeabi-v7a',
    display: { width: 1920, height: 1200 },
    capabilities: DEFAULT_CAPABILITIES,
  },
  S5: {
    label: 'S5',
    androidApiLevel: 31,
    abi: 'arm64-v8a',
    display: { width: 1920, height: 1080 },
    capabilities: DEFAULT_CAPABILITIES,
  },
};

function isHardwareModel(value: string): value is RobotHardwareModel {
  return (ROBOT_HARDWARE_MODELS as readonly string[]).includes(value);
}

function isCapability(value: string): value is RobotHardwareCapability {
  return (ROBOT_HARDWARE_CAPABILITIES as readonly string[]).includes(value);
}

function cleanManufacturer(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException('Invalid robot hardware manufacturer');

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 80) throw new BadRequestException('Invalid robot hardware manufacturer');

  return trimmed;
}

export function normalizeRobotHardwareProfile(input?: HardwareProfileInput | null) {
  if (!input) {
    return {
      hardwareModel: null,
      hardwareProfile: null,
      hardwareCapabilities: null,
    };
  }

  if (!input.model || !isHardwareModel(input.model)) {
    throw new BadRequestException('Invalid robot hardware model');
  }

  const policy = HARDWARE_POLICIES[input.model];
  if (input.androidApiLevel !== policy.androidApiLevel) {
    throw new BadRequestException('Invalid robot hardware Android API level');
  }
  if (input.abi !== policy.abi) {
    throw new BadRequestException('Invalid robot hardware ABI');
  }
  if (input.display?.width !== policy.display.width || input.display?.height !== policy.display.height) {
    throw new BadRequestException('Invalid robot hardware display profile');
  }

  const requestedCapabilities = input.capabilities ?? {};
  const effectiveCapabilities: Record<RobotHardwareCapability, boolean> = { ...policy.capabilities };

  for (const [key, value] of Object.entries(requestedCapabilities)) {
    if (!isCapability(key)) throw new BadRequestException('Invalid robot hardware capability');
    if (typeof value !== 'boolean') throw new BadRequestException('Invalid robot hardware capability value');
    effectiveCapabilities[key] = policy.capabilities[key] && value;
  }

  for (const key of SAFETY_CONTROLLED_CAPABILITIES) {
    effectiveCapabilities[key] = false;
  }

  return {
    hardwareModel: input.model,
    hardwareProfile: {
      schemaVersion: 1,
      model: input.model,
      label: policy.label,
      manufacturer: cleanManufacturer(input.manufacturer),
      androidApiLevel: policy.androidApiLevel,
      abi: policy.abi,
      display: policy.display,
    },
    hardwareCapabilities: effectiveCapabilities,
  };
}
