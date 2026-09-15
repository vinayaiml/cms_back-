export type JwtUserPayload = {
  type: 'user';
  sub: number; // userId
  orgId: number | null;
  isSuperAdmin: boolean;
};

export type JwtRobotPayload = {
  type: 'robot';
  tokenUse: 'access' | 'refresh';
  sub: number; // robotId
  orgId: number;
};

export type JwtPayload = JwtUserPayload | JwtRobotPayload;
