import type { RuleSet } from '../types';
import { javascriptRule, scriptLoadRule } from './javascript';
import { httpErrorRule, requestFailureRule, unexpectedResponseRule } from './network';
import { duplicateRequestRule, largeResourceRule, slowRequestRule } from './performance';
import { storageRule } from './storage';

/**
 * Built-in rules. For logs only the first matching rule reports (storage errors are also
 * JavaScript errors, but should be diagnosed once, as storage); every request rule runs.
 */
export function builtinRules(): RuleSet {
  return {
    log: [storageRule, javascriptRule],
    request: [scriptLoadRule, httpErrorRule, requestFailureRule, unexpectedResponseRule, slowRequestRule, largeResourceRule, duplicateRequestRule()],
  };
}
