import { SetMetadata } from '@nestjs/common';

export const ROBOT_ONLY_KEY = 'robot_only';
export const RobotOnly = () => SetMetadata(ROBOT_ONLY_KEY, true);
