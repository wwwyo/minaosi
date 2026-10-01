import { handleRequest, type Env } from './worker';
import { ReviewConcurrency } from './concurrency';

export { ReviewConcurrency };

type RuntimeEnv = Omit<Env, 'REVIEW_CONCURRENCY'> & { REVIEW_CONCURRENCY: DurableObjectNamespace<ReviewConcurrency> };
export default {
  fetch: (request: Request, env: RuntimeEnv) => handleRequest(request, env),
} satisfies ExportedHandler<RuntimeEnv>;
