import {ApiError} from '@/lib/api-client';

export type NoticeFailure = {
    operation: 'load' | 'read';
    kind: 'login' | 'origin' | 'forbidden' | 'missing' | 'timeout' | 'service' | 'network' | 'unknown';
    status?: number;
};
export function noticeFailure(error: unknown, operation: NoticeFailure['operation']): NoticeFailure {
    if (error instanceof ApiError) {
        const {status, data} = error;
        const originDenied = data !== null && typeof data === 'object' &&
            'message' in data && data.message === 'Cross-origin request denied';
        const kind = status === 401 ? 'login' : status === 403 ? (originDenied ? 'origin' : 'forbidden') :
            status === 404 ? 'missing' : status === 408 ? 'timeout' : status >= 500 ? 'service' : 'unknown';
        return {operation, kind, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? {status} : {})};
    }
    return {operation, kind: error instanceof TypeError ? 'network' : 'unknown'};
}
export function noticeFailureText(error: NoticeFailure, en: boolean): string {
    const action = error.operation === 'load' ? (en ? 'Unable to load notices.' : '公告加载失败。') :
        (en ? 'Unable to confirm read status. The notice remains here; refresh to check its status.' : '保存已阅状态未确认，本页保留公告，请刷新核对。');
    const reasons: Record<NoticeFailure['kind'], [string, string]> = {
        login: ['登录状态已失效，请重新登录后重试。', 'Your session has expired. Sign in again and retry.'],
        origin: ['请求地址校验未通过，请使用网站正式地址重新登录后重试。', 'The site address could not be verified. Sign in at the main site address and retry.'],
        forbidden: ['当前账号无法执行此操作，请重新登录或联系管理员。', 'This account cannot perform this action. Sign in again or contact the administrator.'],
        missing: ['公告或接口已不可用，请刷新列表。', 'The notice or endpoint is unavailable. Refresh the list.'],
        timeout: ['请求超时，请稍后刷新重试。', 'The request timed out. Refresh and retry shortly.'],
        service: ['公告服务暂时不可用，请稍后重试；持续失败请联系管理员。', 'The notice service is temporarily unavailable. Retry shortly or contact the administrator if it persists.'],
        network: ['无法连接，请检查网络或更新浏览器后重试。', 'Unable to connect. Check the network or update your browser and retry.'],
        unknown: ['请刷新后重试；持续失败请联系管理员。', 'Refresh and retry, or contact the administrator if it persists.'],
    };
    return `${action}${en ? ' ' : ''}${reasons[error.kind][en ? 1 : 0]}${error.status ? ` (HTTP ${error.status})` : ''}`;
}
