// The old release entrypoint cannot mutate Plus versions or contact EAS/upstream.
throw new Error('TIEZ Plus uses independent local ARM64 signing. Run npm run build:release:android; EAS/upstream publishing is disabled.');
