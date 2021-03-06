// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/*
  Convert models to GLB with:
  node_modules\.bin\gltf-pipeline.cmd -t -i src/client/models/box.gltf -o src/client/models/box.glb
  // The -t tells it not to embed the textures, but just leave the URIs
 */

const assert = require('assert');
const geom = require('./geom.js');
const glb_parser = require('./glb/parser.js');
const { ATTRIBUTE_TYPE_TO_COMPONENTS } = require('./glb/gltf-type-utils.js');
const renderer = require('./engine.js');
const { fetch } = require('./fetch.js');
const shaders = require('./shaders.js');
const textures = require('./textures.js');
const { vec4 } = require('glov/common/vmath.js');
const { webFSGetFile } = require('./webfs.js');

export let load_count = 0;

export let models = {};

export let default_vshader;
export let default_fshader;

function initShaders() {
  default_vshader = shaders.create('glov/shaders/default.vp');
  default_fshader = shaders.create('glov/shaders/default.fp');
}

function Model(url) {
  this.url = url;
  let idx = url.lastIndexOf('/');
  if (idx !== -1) {
    this.base_url = url.slice(0, idx + 1);
  } else {
    this.base_url = '';
  }
}

Model.prototype.load = function () {
  ++load_count;
  fetch({
    url: this.url,
    response_type: 'arraybuffer',
  }, (err, array_buffer) => {
    --load_count;
    if (err) {
      window.onerror('Model loading error', 'models.js', 0, 0, err);
    } else {
      try {
        this.parse(array_buffer);
      } catch (e) {
        window.onerror('Model loading error', 'models.js', 0, 0, e);
      }
    }
  });
};

const skip_attr = {
  'TANGENT': true,
};

Model.prototype.parse = function (glb_data) {
  let glb = glb_parser.parse(glb_data);
  if (!glb) {
    return;
  }
  // Make Geoms for each primitives within each mesh
  let glb_json = glb.getJSON();
  let objs = [];
  for (let ii = 0; ii < glb_json.meshes.length; ++ii) {
    let mesh = glb_json.meshes[ii];
    for (let jj = 0; jj < mesh.primitives.length; ++jj) {
      let primitives = mesh.primitives[jj];
      let material = glb_json.materials[primitives.material];
      let texture = null;
      if (material) {
        // Just grabbing the base color texture, nothing else
        let bct = (material.pbrMetallicRoughness || {}).baseColorTexture || {};
        let texture_def = glb_json.textures && glb_json.textures[bct.index] || {};
        let sampler_def = glb_json.samplers && glb_json.samplers[texture_def.sampler] || {};
        let image = glb_json.images && glb_json.images[texture_def.source] || {};
        if (image.uri) {
          let params = {
            url: `${this.base_url}${image.uri}`,
            filter_mag: sampler_def.magFilter,
            filter_min: sampler_def.minFilter,
            wrap_s: sampler_def.wrapS,
            wrap_t: sampler_def.wrapT,
          };
          texture = textures.load(params);
        }
      }
      let format = [];
      let buffers = [];
      let bidx = [];
      let total_size = 0;
      let vert_count = 0;
      for (let attr in primitives.attributes) {
        if (skip_attr[attr]) {
          continue;
        }
        assert(shaders.semantic[attr] !== undefined);
        let accessor = glb_json.accessors[primitives.attributes[attr]];
        assert.equal(accessor.componentType, 5126); // F32
        let geom_format = gl.FLOAT;
        let geom_count = ATTRIBUTE_TYPE_TO_COMPONENTS[accessor.type];
        assert(geom_count);
        let my_vert_count = accessor.count/* / geom_count*/;
        if (!vert_count) {
          vert_count = my_vert_count;
        } else {
          assert.equal(vert_count, my_vert_count);
        }
        format.push([shaders.semantic[attr], geom_format, geom_count]);
        let buffer = glb.getBuffer(accessor);
        buffers.push(buffer);
        bidx.push(0);
        total_size += buffer.length;
      }
      // Interleave
      let verts = new Float32Array(total_size);
      let idx = 0;
      for (let vert = 0; vert < vert_count; ++vert) {
        for (let attr = 0; attr < format.length; ++attr) {
          for (let kk = 0; kk < format[attr][2]; ++kk) {
            verts[idx++] = buffers[attr][bidx[attr]++];
          }
        }
      }
      // Get indices
      let accessor = glb_json.accessors[primitives.indices];
      assert(accessor); // must be an indexed primitive set
      assert.equal(accessor.type, 'SCALAR');
      let idxs = glb.getBuffer(accessor);
      if (accessor.componentType === 5125) { // Uint32
        assert(vert_count < 65536); // Fits in 16-bits
        // Just convert to 16-bit
        idxs = new Uint16Array(idxs);
      } else {
        assert.equal(accessor.componentType, 5123); // Uint16
      }
      objs.push({
        geom: geom.create(format, verts, idxs, primitives.mode),
        texture,
      });
    }
  }
  // TODO: Something with nodes to tie together and position the meshes
  this.data = {
    objs,
    // glb, - Don't keep this, release it and any unreferenced data/buffers
  };
};

Model.prototype.draw = function (mat) {
  renderer.updateMatrices(mat); // before setting shader
  shaders.bind(default_vshader, default_fshader, {
    color: vec4(1, 1, 1, 1),
  });
  let objs = this.data.objs;
  for (let ii = 0; ii < objs.length; ++ii) {
    let obj = objs[ii];
    if (obj.texture) {
      textures.bind(0, obj.texture);
    }
    obj.geom.draw();
  }
};

// Just draw the geometry, without any other binding
Model.prototype.drawGeom = function () {
  let objs = this.data.objs;
  for (let ii = 0; ii < objs.length; ++ii) {
    let obj = objs[ii];
    obj.geom.draw();
  }
};

export function load(url) {
  if (models[url]) {
    return models[url];
  }
  let model = models[url] = new Model(url);
  model.data = models.box.data; // stub until loaded
  model.load();
  return model;
}

export function startup() {
  initShaders();
  let model_box = models.box = new Model('box');
  model_box.parse(webFSGetFile('glov/models/box_textured_embed.glb').buffer);
}
