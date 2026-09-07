// Pure control-space helpers. Keeping movement and look in one convention prevents
// camera controls and character movement from drifting into opposite directions.

export interface HorizontalBasis {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

export interface HorizontalMove {
  x: number;
  z: number;
}

export function horizontalBasis(yaw: number): HorizontalBasis {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    forwardX: -sin,
    forwardZ: -cos,
    rightX: cos,
    rightZ: -sin,
  };
}

export function cameraRelativeMove(
  strafe: number,
  forward: number,
  yaw: number,
  reverseForward = false,
  reverseStrafe = false,
): HorizontalMove {
  const basis = horizontalBasis(yaw);
  if (reverseForward) forward = -forward;
  if (reverseStrafe) strafe = -strafe;
  let x = basis.rightX * strafe + basis.forwardX * forward;
  let z = basis.rightZ * strafe + basis.forwardZ * forward;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  return { x, z };
}

export function applyMouseLook(
  yaw: number,
  pitch: number,
  deltaX: number,
  deltaY: number,
  sensitivity: number,
  invertX = false,
  invertY = false,
): { yaw: number; pitch: number } {
  const xSign = invertX ? -1 : 1;
  const ySign = invertY ? -1 : 1;
  return {
    yaw: yaw - deltaX * 0.0024 * sensitivity * xSign,
    pitch: Math.max(-1.1, Math.min(0.55, pitch - deltaY * 0.0021 * sensitivity * ySign)),
  };
}
