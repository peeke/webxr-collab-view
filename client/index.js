jsfeat.yape06.laplacian_threshold = 30 | 0;
jsfeat.yape06.min_eigen_value_threshold = 25 | 0;

async function getImageU8(url) {
  const img = new Image();
  img.src = url;

  await new Promise(resolve => {
    img.onload = resolve;
  });

  const { naturalWidth: width, naturalHeight: height } = img;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.scale(600 / width, 800 / height);
  ctx.drawImage(ctx.canvas, 0, 0);

  console.log(ctx.getImageData(0, 0, 600, 800));
  return ctx.getImageData(0, 0, 600, 800);
}

const cvs1 = document.getElementById("cvs1");
const cvs2 = document.getElementById("cvs2");

Promise.all([getImageU8("/img/3.jpg"), getImageU8("/img/4.jpg")]).then(
  ([leftSource, rightSource]) => {
    const [leftCorners, leftDescriptors] = findCorners(leftSource);
    const [rightCorners, rightDescriptors] = findCorners(rightSource);

    const matches = match_pattern(leftDescriptors, rightDescriptors).slice(
      0,
      6
    );

    const from = matches.map(match => leftCorners[match.screen_idx]);
    const to = matches.map(match => rightCorners[match.pattern_idx]);

    const ctx1 = cvs1.getContext("2d");
    ctx1.putImageData(leftSource, 0, 0);
    from.forEach((point, i) => {
      ctx1.fillStyle = [
        "#ff00ff",
        "#ffff00",
        "#00ffff",
        "#ff0000",
        "#00ff00",
        "#0000ff"
      ][i % 6]; // Red color
      ctx1.beginPath(); //Start path
      ctx1.arc(point.x, point.y, 4, 0, Math.PI * 2, true);
      ctx1.fill();
    });

    const ctx2 = cvs2.getContext("2d");
    ctx2.putImageData(rightSource, 0, 0);
    to.forEach((point, i) => {
      ctx2.fillStyle = [
        "#ff00ff",
        "#ffff00",
        "#00ffff",
        "#ff0000",
        "#00ff00",
        "#0000ff"
      ][i % 6]; // Red color
      ctx2.beginPath(); //Start path
      ctx2.arc(point.x, point.y, 4, 0, Math.PI * 2, true);
      ctx2.fill();
    });

    // homograph
    const homo3x3 = findHomography(from, to, matches.length);
    const mat3d = [
      ...homo3x3.data.slice(0, 3),
      0,
      ...homo3x3.data.slice(3, 6),
      0,
      ...homo3x3.data.slice(6, 9),
      0,
      0,
      0,
      0,
      1
    ].join(",");

    cvs2.style.transform = `matrix3d(${mat3d})`;
  }
);

function findCorners(imgData) {
  const img = new jsfeat.matrix_t(
    imgData.width,
    imgData.height,
    jsfeat.U8_t | jsfeat.C1_t,
    imgData.buffer
  );

  jsfeat.imgproc.grayscale(
    imgData.data,
    imgData.width,
    imgData.height,
    img,
    jsfeat.COLOR_RGBA2GRAY
  );

  jsfeat.imgproc.gaussian_blur(img, img, 10 | 0);

  const corners = [];
  const descriptors = new jsfeat.matrix_t(32, 500, jsfeat.U8_t | jsfeat.C1_t);

  let i = 640 * 480;
  while (--i >= 0) {
    corners[i] = new jsfeat.keypoint_t(0, 0, 0, 0, -1);
  }

  num_corners = detect_keypoints(img, corners, 500);

  jsfeat.orb.describe(img, corners, num_corners, descriptors);

  return [corners, descriptors];
}

function findHomography(from, to, count) {
  const homo_kernel = new jsfeat.motion_model.homography2d();
  const homo_transform = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);

  homo_kernel.run(from, to, homo_transform, count);

  return homo_transform;
}

var match_t = (function() {
  function match_t(screen_idx, pattern_lev, pattern_idx, distance) {
    if (typeof screen_idx === "undefined") {
      screen_idx = 0;
    }
    if (typeof pattern_lev === "undefined") {
      pattern_lev = 0;
    }
    if (typeof pattern_idx === "undefined") {
      pattern_idx = 0;
    }
    if (typeof distance === "undefined") {
      distance = 0;
    }

    this.screen_idx = screen_idx;
    this.pattern_lev = pattern_lev;
    this.pattern_idx = pattern_idx;
    this.distance = distance;
  }
  return match_t;
})();

function detect_keypoints(img, corners, max_allowed) {
  // detect features
  var count = jsfeat.yape06.detect(img, corners, 17);

  // sort by score and reduce the count if needed
  if (count > max_allowed) {
    jsfeat.math.qsort(corners, 0, count - 1, function(a, b) {
      return b.score < a.score;
    });
    count = max_allowed;
  }

  // calculate dominant orientation for each keypoint
  for (var i = 0; i < count; ++i) {
    corners[i].angle = ic_angle(img, corners[i].x, corners[i].y);
  }

  return count;
}

const u_max = new Int32Array([
  15,
  15,
  15,
  15,
  14,
  14,
  14,
  13,
  13,
  12,
  11,
  10,
  9,
  8,
  6,
  3,
  0
]);

function ic_angle(img, px, py) {
  var half_k = 15; // half patch size
  var m_01 = 0,
    m_10 = 0;
  var src = img.data,
    step = img.cols;
  var u = 0,
    v = 0,
    center_off = (py * step + px) | 0;
  var v_sum = 0,
    d = 0,
    val_plus = 0,
    val_minus = 0;

  // Treat the center line differently, v=0
  for (u = -half_k; u <= half_k; ++u) m_10 += u * src[center_off + u];

  // Go line by line in the circular patch
  for (v = 1; v <= half_k; ++v) {
    // Proceed over the two lines
    v_sum = 0;
    d = u_max[v];
    for (u = -d; u <= d; ++u) {
      val_plus = src[center_off + u + v * step];
      val_minus = src[center_off + u - v * step];
      v_sum += val_plus - val_minus;
      m_10 += u * (val_plus + val_minus);
    }
    m_01 += v * v_sum;
  }

  return Math.atan2(m_01, m_10);
}

// non zero bits count
function popcnt32(n) {
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
}

// naive brute-force matching.
// each on screen point is compared to all pattern points
// to find the closest match
function match_pattern(descriptorsLeft, descriptorsRight) {
  const matches = [];
  let i = 640 * 480;
  while (--i >= 0) {
    matches[i] = new match_t();
  }

  var q_cnt = descriptorsLeft.rows;
  var query_u32 = descriptorsLeft.buffer.i32; // cast to integer buffer
  var qd_off = 0;
  var qidx = 0,
    lev = 0,
    pidx = 0,
    k = 0;
  var num_matches = 0;

  for (qidx = 0; qidx < q_cnt; ++qidx) {
    var best_dist = 256;
    var best_dist2 = 256;
    var best_idx = -1;
    var best_lev = -1;

    var lev_descr = descriptorsRight;
    var ld_cnt = lev_descr.rows;
    var ld_i32 = lev_descr.buffer.i32; // cast to integer buffer
    var ld_off = 0;

    for (pidx = 0; pidx < ld_cnt; ++pidx) {
      var curr_d = 0;
      // our descriptor is 32 bytes so we have 8 Integers
      for (k = 0; k < 8; ++k) {
        curr_d += popcnt32(query_u32[qd_off + k] ^ ld_i32[ld_off + k]);
      }

      if (curr_d < best_dist) {
        best_dist2 = best_dist;
        best_dist = curr_d;
        best_lev = lev;
        best_idx = pidx;
      } else if (curr_d < best_dist2) {
        best_dist2 = curr_d;
      }

      ld_off += 8; // next descriptor
    }

    // filter out by some threshold
    if (best_dist < 48) {
      matches[num_matches].screen_idx = qidx;
      matches[num_matches].pattern_lev = best_lev;
      matches[num_matches].pattern_idx = best_idx;
      num_matches++;
    }

    qd_off += 8; // next query descriptor
  }

  return matches.slice(0, num_matches);
}
