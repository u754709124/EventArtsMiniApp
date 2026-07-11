export type DetailRequestToken = Readonly<{ sequence: number; routeId: string }>;

export function createDetailRequestGate() {
  let sequence = 0;
  let activeAbort: (() => void) | undefined;

  return {
    begin(routeId: string, abort: () => void): DetailRequestToken {
      activeAbort?.();
      activeAbort = abort;
      sequence += 1;
      return { sequence, routeId };
    },
    isCurrent(token: DetailRequestToken) {
      return token.sequence === sequence;
    },
    dispose() {
      activeAbort?.();
      activeAbort = undefined;
      sequence += 1;
    }
  };
}
