// public/js/render/fx/notes.js — content-owned notes (b.snap `proj`): 丰川祥子's 音符, the first visual that is NOT
// driven by a b.ev 'atk' event.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).
//
// She fires her notes on her own (【自由移动】 when nothing is in range, then 【追踪移动】 — server/sim/content/kits/
// ops/op-oblvns.js `noteSteer`), so there is no attack to hang a projectile visual on and no target view to home on.
// The sim streams their authoritative positions in `b.snap.proj` (`[[id, x, y, kind]]`, server/sim/battle/events.js) and
// this file keeps one floating, haloed music glyph per projectile id — placed where the sim's own hit test has it, so a
// note lands with the damage it deals. `kind` is 'note' (her talent's) or 'noteSkill' (her skills'), which picks the
// style.js PROJ entry.

import { PROJ, NOTE_FX } from '../style.js';
import { SHOT_HEIGHT, bodyZ } from './camera.js';

/** Content-owned notes (b.snap `proj`): the live cap (the oldest note is recycled past it) and the fade-out (real s) of
 *  a note that left the snapshot — the note dims and sinks away instead of popping out of existence. */
const MAX_NOTES = 64, NOTE_FADE = 0.35;
/** Notes: trail motes per real second of one note, and the slow float (tiles) of the glyph above its flight point. */
const NOTE_HZ = 5, NOTE_BOB = 0.05;
/**
 * The three note glyphs of render/textures.js and their weights — one is picked at random for every note when it
 * appears and kept for its whole life (syncNotes): 八分音符 / 十六分音符 / 高音谱号, 40 % / 40 % / 20 %. Tune the weights
 * here (they must add up to 1); `pickNoteFrame` takes an rng so tests can pin the choice down.
 */
export const NOTE_FRAMES = Object.freeze([Object.freeze(['note', 0.4]), Object.freeze(['note16', 0.4]), Object.freeze(['treble', 0.2])]);
/** Weighted random glyph of one note: a frame name of the FX atlas ('note' | 'note16' | 'treble'). */
export function pickNoteFrame(rand = Math.random) {
  let r = rand();
  for (const [name, weight] of NOTE_FRAMES) { if (r < weight) return name; r -= weight; }
  return NOTE_FRAMES[NOTE_FRAMES.length - 1][0];
}

export class FxNotes {
  /**
   * 丰川祥子's notes: `list` = the snapshot's `proj` entries `[id, x, y, kind]` — board coordinates (column x, row y,
   * the frame of `snap.units`) and the projectile's own stable id; `kind` is 'note' (her talent's) or 'noteSkill' (her
   * skills'). Called once per rendered battle frame with the list of the snapshot shown at renderT (render/app.js →
   * interp.projAt), so the note is drawn where the sim's own hit test has it:
   *   * an id that is new gets a pooled note sprite (its glyph + halo, additive, in the projectile layer) — the glyph
   *     is one of NOTE_FRAMES picked at random for this note and kept for its whole life,
   *   * an id that is still there is moved to its position — the same camera mapping every other projectile uses
   *     (_proj + bodyZ(SHOT_HEIGHT.aim), i.e. the chest height of a unit standing on that tile),
   *   * an id that left the list (landed / faded out of range / the battle ended) flashes once in NOTE_FX, fades out
   *     over NOTE_FADE and is pooled — an empty or missing `list` fades every note out, so nothing is ever leaked.
   * A note's `kind` picks PROJ.note / PROJ.noteSkill (unknown kinds fall back to PROJ.note).
   */
  syncNotes(list) {
    const seen = this._noteSeen || (this._noteSeen = new Set());
    seen.clear();
    if (Array.isArray(list)) {
      for (const e of list) {
        if (!Array.isArray(e) || e.length < 3) continue;
        const id = e[0];
        if (!(typeof id === 'number' || typeof id === 'string')) continue;
        const x = Number(e[1]), y = Number(e[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        seen.add(id);
        let n = this.notes.get(id);
        if (!n) {
          n = this._takeNote();
          n.id = id; n.emit = Math.random(); n.out = 0;
          n.seed = ((typeof id === 'number' ? id : this.notes.size) * 1.7) % 6.283;   // off-phase float / sway per note
          n.frame = pickNoteFrame();                                                  // 八分 / 十六分 / 高音谱号
          this.notes.set(id, n);
        }
        n.spec = PROJ[e[3]] && PROJ[e[3]].look === 'note' ? PROJ[e[3]] : PROJ.note;
        n.x = x; n.y = y; n.out = 0;
      }
    }
    for (const n of this.notes.values()) if (!seen.has(n.id)) n.out = Math.max(n.out, 1e-6);   // start its fade-out
  }

  /** A pooled note record: its glyph sprite + a halo (both additive, shown from the next _updateNotes). */
  _takeNote() {
    if (this.notes.size >= MAX_NOTES) {   // the oldest note goes, exactly like MAX_PROJ for shots
      const oldest = this.notes.keys().next().value;
      const n = this.notes.get(oldest);
      this.notes.delete(oldest);
      this._freeNote(n);
    }
    let n = this.noteFree.pop();
    if (!n) {
      const P = this.P;
      const mk = (tex) => {
        const sp = new P.Sprite(this.tex[tex]);
        sp.anchor.set(0.5);
        sp.blendMode = P.BLEND_MODES.ADD;
        sp.visible = false;
        this.projLayer.addChild(sp);
        return sp;
      };
      n = { halo: mk('glow'), core: mk('note'), id: null, spec: PROJ.note, frame: 'note', x: 0, y: 0, seed: 0, emit: 0, out: 0, burst: false };
    }
    return n;
  }

  _freeNote(n) {
    n.core.visible = n.halo.visible = false;
    n.core.alpha = n.halo.alpha = 0;
    n.id = null;
    n.burst = false;   // the parting flash belongs to the life that just ended
    this.noteFree.push(n);
  }

  /**
   * A note left the snapshot (it landed, or drifted out of her range): a short flash + a few sparks in the effect
   * colour (NOTE_FX) at its last spot, so a note never just blinks out — the same colour family as the halo and trail.
   */
  _noteGone(x, y, s) {
    this.particle('glow', x, y, { tint: NOTE_FX, life: 0.22, s0: (s / 128) * 0.3, s1: (s / 128) * 0.62, a0: 0.75, a1: 0 });
    if (this.rich) this.burst(x, y, s, 4, NOTE_FX, { speed: 1.7, life: 0.26, tex: 'spark', size: 0.3 });
  }

  /** World height of a note at (x, y): the ground under it plus the `SHOT_HEIGHT.aim` point of a unit standing there
   *  (bodyZ — the height shots and beams are aimed at), so notes fly through the chests of what they hit. */
  _noteZ(cam, x, y) {
    const v = this._noteV || (this._noteV = { x: 0, y: 0, z: 0, hover: 0 });
    v.x = x; v.y = y; v.z = this._groundZ(x, y); v.hover = 0;
    return bodyZ(cam, v, SHOT_HEIGHT.aim);
  }

  /**
   * One frame of every live note: placed at its board position (the snapshot's, interpolated by the render clock),
   * floating gently, a few motes drifting off it; a note that left the snapshot flashes once in NOTE_FX and then dims
   * and shrinks away over NOTE_FADE. Its glyph (n.frame) never changes. The glyph is drawn at every quality — 'low'
   * only loses the motes, the parting sparks and most of the halo (still clearly visible).
   */
  _updateNotes(dt) {
    if (!this.notes.size) return;
    const cam = this.ctx.cam();
    const rich = this.rich, low = !rich;
    for (const [id, n] of this.notes) {
      let fade = 1;
      if (n.out > 0) {
        n.out += dt;
        fade = 1 - n.out / NOTE_FADE;
        if (fade <= 0) { this._freeNote(n); this.notes.delete(id); continue; }
      }
      const spec = n.spec || PROJ.note;
      const p = this._proj(n.x, n.y, this._noteZ(cam, n.x, n.y), this._p);
      const s = p.s, px = p.x;
      if (n.out > 0 && !n.burst) { n.burst = true; this._noteGone(px, p.y, s); }   // it just left the field
      // a slow float and sway: the note reads as playing in the air, not as a sprite pinned to the tile
      const py = p.y - (NOTE_BOB * (0.6 + 0.4 * Math.sin(this.time * 2.2 + n.seed))) * s;
      const k = 0.85 + 0.15 * fade;
      const core = n.core;
      core.texture = this.tex[n.frame] || this.tex.note;   // its own glyph, fixed for its whole life
      core.tint = spec.tint;
      core.position.set(px, py);
      core.rotation = 0.16 * Math.sin(this.time * 1.7 + n.seed);
      core.scale.set(((spec.width || 0.5) * s / 128) * k, ((spec.head || 0.55) * s / 128) * k);
      core.alpha = fade;
      core.visible = true;
      const halo = n.halo;
      halo.tint = spec.glow;
      halo.position.set(px, py);
      halo.scale.set(((spec.halo || 0.9) * s * (0.94 + 0.06 * Math.sin(this.time * 3.1 + n.seed)) * (0.8 + 0.2 * fade)) / 128);
      halo.alpha = (spec.haloA ?? 0.75) * (low ? 0.5 : 1) * fade;
      halo.visible = true;
      if (!low && n.out === 0 && this._room()) {   // a few motes drifting behind it (cosmetic, never at 'low')
        n.emit += dt * NOTE_HZ;
        for (let i = 0; n.emit >= 1 && i < 2; i++) {
          n.emit -= 1;
          this._mote(px, py, s, spec.trail ?? spec.glow, 0.4);
        }
      }
    }
  }
}
