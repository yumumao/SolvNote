import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('privacy of diagnostic logging', () => {
  it('keeps browser events local, including old explicit send requests', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const {frontendLogger} = await import('@/lib/frontend-logger');
    frontendLogger.info('[Settings]', 'Saved', {apiKey:'SYNTHETIC_PRIVATE_KEY', email:'synthetic@example.invalid'}, {sendToBackend:true});
    frontendLogger.forceFlush();
    await vi.runAllTimersAsync();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['production', 'development'])('redacts free-form context and error payloads in %s', async mode => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('LOG_LEVEL', 'debug');
    const lines: string[] = [];
    for(const method of ['log','warn','error'] as const) vi.spyOn(console,method).mockImplementation((...args) => {lines.push(args.join(' '));});
    const {createLogger} = await import('@/lib/logger');
    const logger=createLogger('privacy-test').child({email:'private@example.invalid'});
    const error=Object.assign(new Error('SYNTHETIC_PASSWORD_IN_ERROR'), {code:'P2002',cause:{apiKey:'SYNTHETIC_CAUSE_KEY'}});
    logger.error({error,question:'PRIVATE_QUESTION_TEXT',nested:{token:'SYNTHETIC_NESTED_KEY'},count:3,ok:false},'Request failed');
    logger.box('Request failed',{apiKey:'SYNTHETIC_BOX_KEY',count:2});
    logger.box('Request failed','PRIVATE_STRING_BODY');
    const output=lines.join('\n');
    for(const secret of ['private@example.invalid','SYNTHETIC_PASSWORD_IN_ERROR','SYNTHETIC_CAUSE_KEY','PRIVATE_QUESTION_TEXT','SYNTHETIC_NESTED_KEY','SYNTHETIC_BOX_KEY','PRIVATE_STRING_BODY']) expect(output).not.toContain(secret);
    expect(output).toContain('Request failed');
    expect(output).toContain('count');
    expect(output).toContain('3');
  });
});
