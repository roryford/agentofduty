/** Optional render-only GPU timings. Queries never block the render thread. */
export class GpuTimer {
  constructor(gl, enabled) {
    this.gl = gl;
    this.ext = enabled ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.pending = [];
    this.samples = [];
    this.current = null;
    this.disjointCount = 0;
  }
  begin() {
    const gl = this.gl, ext = this.ext;
    if (!ext) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending.length = 0; this.disjointCount++;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift();
      this.samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      if (this.samples.length > 512) this.samples.shift();
      gl.deleteQuery(query);
    }
    if (this.pending.length >= 8) return;
    this.current = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
  }
  end() {
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = null;
  }
  dispose() { for (const query of this.pending) this.gl.deleteQuery(query); this.pending.length = 0; }
}
