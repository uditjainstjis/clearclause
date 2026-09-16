/**
 * Bounded-concurrency mapping, shared by the analysis and comparison pipelines.
 *
 * A worker pool rather than fixed-size batches: batching would idle on the
 * slowest item in each batch, which for contracts — where clause lengths vary
 * by an order of magnitude — is most of the time.
 */

/**
 * Map over items with bounded concurrency, yielding each result the moment it
 * is ready rather than in input order.
 *
 * @param items items to process
 * @param limit maximum number of in-flight calls
 * @param fn    the work to do per item
 */
export async function* mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const executing = new Map<number, Promise<{ slot: number; value: R }>>();
  let next = 0;

  const start = (slot: number): void => {
    const item = items[next];
    if (item === undefined) return;
    next++;
    executing.set(
      slot,
      fn(item).then((value) => ({ slot, value })),
    );
  };

  for (let slot = 0; slot < Math.min(limit, items.length); slot++) start(slot);

  while (executing.size > 0) {
    const { slot, value } = await Promise.race(executing.values());
    executing.delete(slot);
    yield value;
    if (next < items.length) start(slot);
  }
}
