// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('container startup release contract', () => {
    it('ships the full bcrypt package for the CommonJS bootstrap, not only Next ESM tracing', () => {
        expect(source('Dockerfile')).toMatch(/COPY --from=builder[^\n]*\/app\/node_modules\/bcryptjs \.\/node_modules\/bcryptjs/);
    });

    it('loads the real seed imports during image construction without executing bootstrap', () => {
        expect(source('Dockerfile')).toMatch(/RUN node -e "require\('\.\/dist-scripts\/scripts\/seed-admin\.js'\)/);
    });

    it('requires a native container startup check before exporting publishable digests', () => {
        const workflow = source('.github/workflows/build-docker.yml');
        const smoke = workflow.indexOf('bash scripts/smoke-container.sh');
        expect(smoke).toBeGreaterThan(workflow.indexOf('id: build'));
        expect(smoke).toBeLessThan(workflow.indexOf('- name: Export digest'));
        expect(workflow).toContain("IMAGE_REF: ${{ needs.prepare.outputs.image }}@${{ steps.build.outputs.digest }}");
    });
});
