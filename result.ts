export type Result<K, E> =
  | {
      success: true;
      data: K;
    }
  | {
      success: false;
      error: E;
    };

export function isOk<K, E>(
  result: Result<K, E>
): result is Extract<Result<K, E>, { success: true }> {
  return result.success;
}

export function isError<K, E>(
  result: Result<K, E>
): result is Extract<Result<K, E>, { success: false }> {
  return !result.success;
}

export function ok<K, E>(data: K): Result<K, E> {
  return {
    success: true,
    data,
  };
}
export function err<K, E>(error: E): Result<K, E> {
  return {
    success: false,
    error,
  };
}
