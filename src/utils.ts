export function isFirefox() {
    return window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}

export function getFirefoxVersion() {
    const match = window.navigator.userAgent.toLowerCase().match(/firefox\/([0-9]+)\./);

    if (!match || match.length < 2) {
        return -1;
    }

    return parseInt(match[1], 10);
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

