import {jest, expect} from '@jest/globals';

import {isFirefox, getFirefoxVersion} from './utils';

describe('isFirefox', () => {
    const userAgentGetter = jest.spyOn(window.navigator, 'userAgent', 'get');

    afterAll(() => {
        jest.resetAllMocks();
    });

    it('empty user agent', () => {
        userAgentGetter.mockReturnValue('');
        expect(isFirefox()).toBe(false);
    });

    it('not firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');
        expect(isFirefox()).toBe(false);
    });

    it('firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0');
        expect(isFirefox()).toBe(true);
    });
});

describe('getFirefoxVersion', () => {
    const userAgentGetter = jest.spyOn(window.navigator, 'userAgent', 'get');

    afterAll(() => {
        jest.resetAllMocks();
    });

    it('empty user agent', () => {
        userAgentGetter.mockReturnValue('');
        expect(getFirefoxVersion()).toBe(-1);
    });

    it('not firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');
        expect(getFirefoxVersion()).toBe(-1);
    });

    it('firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0');
        expect(getFirefoxVersion()).toBe(112);
    });
});
