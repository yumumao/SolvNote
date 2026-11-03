import Link from 'next/link';
import { APP_REPOSITORY } from '@/lib/app-info';

export const metadata = { title: '隐私与数据说明 · SolvNote' };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground">
      <article className="mx-auto max-w-3xl space-y-7 text-sm leading-7">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">隐私与数据说明</h1>
          <p className="text-muted-foreground">请在注册、上传题目或使用AI前了解这些边界。本页说明项目的处理方式；不同部署所选AI服务、托管平台和备份策略可能不同。</p>
        </header>
        <section>
          <h2 className="text-lg font-medium">账号与学习资料</h2>
          <p>站点保存邮箱、昵称、学段等账号资料，以及你提交的题目、图片、答案、笔记和学习记录。密码以哈希保存。普通账号只能访问自己的学习资料；站点管理员可以管理账号并查看或导出站内学习数据。普通题目和笔记并非端到端加密，部署者和数据库管理者可以接触这些资料。</p>
        </section>
        <section>
          <h2 className="text-lg font-medium">AI与外部服务</h2>
          <p>使用AI时，相关题文、题图、解答、学段和本题会话内容会发送给当前选用的AI服务或中转服务。系统不会额外把账号邮箱或密码作为解题字段发送，但题目或图片中自带的姓名、学号等仍会随内容发送。上传前请裁去不必要的个人信息。外部AI服务的数据保留和训练政策由对应服务决定。</p>
          <p>登录和注册使用Cloudflare Turnstile进行安全验证。打开GeoGebra演示时会加载其外部脚本和小程序。查看包含外部图片地址的材料时，浏览器可能向该图片服务器请求资源，使其得知IP等连接信息。项目链接不会自动上传学习资料；点击GitHub后适用GitHub自己的隐私规则。</p>
        </section>
        <section>
          <h2 className="text-lg font-medium">密钥、日志与浏览器</h2>
          <p>站点AI密钥由服务端使用，普通账号不能通过配置界面或导出接口获取。个人AI配置和部分AI任务内容在服务端加密保存；系统密钥的存储方式取决于部署配置，可能使用环境变量或服务端配置文件。这些措施不等于对部署者隐藏。自定义AI连接会把你提供的密钥发送给你选定的服务，请只填写可信地址。</p>
          <p>本版本不再自动回传浏览器诊断日志，也不收集其完整页面地址或浏览器标识。服务端应用日志保留固定事件、计数和状态，省略自由文本上下文及错误详情。托管平台、网络代理、Cloudflare或AI供应商仍可能保留自己的访问日志；旧版本已经产生的日志和备份不会因升级自动清除。</p>
          <p>浏览器可能缓存静态资源并保存页面偏好；本地草稿与临时阅读内容以实际功能为准。共享设备使用后请退出账号，按需清除站点数据。</p>
        </section>
        <section>
          <h2 className="text-lg font-medium">有效期、导出与删除</h2>
          <p>试用账号到期后停止访问；按当前程序规则，到期超过30天的账号及关联资料会由后台清理任务处理。后台运行状态、备份及平台日志可能延长实际保留时间，这不是到期即刻彻底擦除的承诺。解题记录通常保留到你删除或账号清理；部分临时任务另有较短保留规则。</p>
          <p>请在试用到期前通过设置导出需要保留的学习资料。可以在应用中删除自己的资料，或联系本部署的管理员处理账号及备份事宜。项目仓库维护者无法代替其他部署的管理员删除其数据。</p>
        </section>
        <section>
          <h2 className="text-lg font-medium">自行部署</h2>
          <p>邀请码用完或试用结束后，可以获取项目源码自行部署，并自备AI服务。自行部署不会自动迁移本站账号或资料；请先导出资料，并按项目文档配置和保管密钥、数据库及备份。</p>
          <a className="text-primary underline underline-offset-4" href={APP_REPOSITORY} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">SolvNote · 项目源码与部署说明</a>
        </section>
        <nav className="flex gap-5 border-t pt-5"><Link className="text-primary underline" href="/login">返回登录</Link><Link className="text-primary underline" href="/register">前往注册</Link></nav>
      </article>
    </main>
  );
}
