// MediaPipe hand landmark indices: 0 is the wrist, then four per finger from
// the base (thumb 1-4, index 5-8, middle 9-12, ring 13-16, pinky 17-20).
export const WRIST = 0, THUMB_IP = 3, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9;
export const RING_MCP = 13, PINKY_MCP = 17;

// Finger landmarks needed for the open-hand test the swipe gate uses.
export const TIPS = [8, 12, 16, 20];    // index, middle, ring, pinky
export const PIPS = [6, 10, 14, 18];
