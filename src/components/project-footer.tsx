import { APP_NAME, APP_REPOSITORY } from "@/lib/app-info";
import type { Language } from "@/lib/translations";
import { InstallApp } from "./install-app";

type ProjectFooterProps = {
    language: Language;
    showSelfHosting?: boolean;
    className?: string;
};

export function ProjectFooter({ language, showSelfHosting = false, className = "" }: ProjectFooterProps) {
    const isEnglish = language === "en";

    return (
        <footer className={`w-full space-y-2 text-center text-xs leading-relaxed text-muted-foreground print:hidden ${className}`}>
            {showSelfHosting && <p>
                {isEnglish
                    ? "No invitation codes left or your trial has expired? Get the source and self-host with your own AI service."
                    : "邀请码用完或试用到期？可获取源码自行部署，需自备AI服务。"}
            </p>}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <a
                    href={APP_REPOSITORY}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                    {APP_NAME} · GitHub
                </a>
                <span aria-hidden="true">·</span>
                <a href="/privacy" className="underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
                    {isEnglish ? "Privacy" : "隐私说明"}
                </a>
            </div>
            <InstallApp language={language}/>
        </footer>
    );
}
