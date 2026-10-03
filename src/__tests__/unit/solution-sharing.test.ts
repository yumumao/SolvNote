import {openSolutionReader} from '@/lib/solution-reader';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
import { describe,it,expect,vi,afterEach } from 'vitest';
import { solutionPlainText,solutionUnits } from '@/lib/solution-share';
function doc(html:string){const e=document.createElement('article');e.innerHTML=html;return e}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
describe('private local solution snapshots',()=>{
 it('preserves numbered steps while emitting every KaTeX formula only once',()=>{
  const e=doc('<h1>解题过程</h1><ol start="3"><li>计算<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x=4</annotation></semantics></math></span><span class="katex-html">x=4</span></span>。</li><li>核验。</li></ol>');
  const text=solutionPlainText(e);expect(text).toContain('3. 计算x=4。');expect(text).toContain('4. 核验。');expect(text.match(/x=4/g)).toHaveLength(1);expect(e.querySelector('.katex')).not.toBeNull();
 });
 it('keeps loose-list labels on the same line as their paragraph',()=>{
  const e=doc('<ol>\n<li>\n<p>代入半径。</p>\n</li>\n<li>\n<p>检查结果。</p>\n</li>\n</ol><ul><li>\n<p>复核。</p>\n</li></ul>');
  const text=solutionPlainText(e);expect(text).toContain('1. 代入半径。');expect(text).toContain('2. 检查结果。');expect(text).toContain('• 复核。');
 });
 it('reader snapshot boundary excludes executable DOM and remote image objects',()=>{
  expect(parseSolutionSnapshot(doc('<script>steal()</script>'))).toBeNull();
  expect(parseSolutionSnapshot({analysis:'合成',originalImage:'https://example.com/track'})?.originalImage).toBeUndefined();
 });
 it('splits at list items and preserves original numbering and formula DOM',()=>{
  const e=doc('<h1>标题</h1><section data-solution-section><h2>解题过程</h2><div class="markdown-content"><ol start="5"><li>第一步<span class="katex">公式</span></li><li>第二步</li></ol></div></section>');
  const units=solutionUnits(e);expect(units).toHaveLength(4);expect(units[2].querySelector('ol')?.getAttribute('start')).toBe('5');expect(units[3].querySelector('ol')?.getAttribute('start')).toBe('6');expect(units[2].querySelector('.katex')?.textContent).toBe('公式');expect(e.querySelectorAll('li')).toHaveLength(2);
 });
 it('opens exactly one noopener tab even when window.open returns null',()=>{
  vi.useFakeTimers();const close=vi.fn();vi.stubGlobal('BroadcastChannel',class{onmessage=null;postMessage=vi.fn();close=close});
  const open=vi.spyOn(window,'open').mockReturnValue(null);openSolutionReader({analysis:'合成',includeQuestion:false,includeAnswer:false});
  expect(open).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\/solution-reader#[a-f0-9-]{36}$/),'_blank','noopener,noreferrer');vi.runAllTimers();expect(close).toHaveBeenCalledTimes(1);
 });
});
