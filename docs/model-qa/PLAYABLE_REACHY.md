# Playable Reachy and Watti LED checks

The CAD GLBs and source provenance are unchanged. Runtime presentation adds an independent Reachy player adapter and a warm-white Watti head ring. See [numeric results](reachy-player-watti-led.json).

Reachy retains the original connected head mechanism. Its player base glides and pivots on the ground; it has no invented legs. The head strike peaks at the shared simulation contact times, 0.09 seconds for a tap and 0.19 seconds for a charged shot. Players use 1.75-unit normalization, while the separate touchline referee uses 1.6. Each player ID/kind and the referee have independent nodes, poses, materials and team rings.

The numerical asset check sampled 4,492 Reachy poses covering movement, tracking, strikes and celebration. All six rod endpoints remained attached, the support surface stayed on the floor, and joint limits were respected. These are geometry checks, not a physical-device performance measurement.

Watti's emissive torus follows the Fusion LED origin and CAD front plane: 64.2 mm radius, 1.2 mm tube radius, and a small offset beyond the front lip. It is parented to `joint_head_yaw` within `body_head_link`, so the light follows the final head rotation. The bronze center is retained. Attachment was checked across 121 articulated poses; ring geometry/material disposal happens once per instance.

Browser checks include Reachy versus Reachy with a separate referee, Watti versus Reachy, and phone viewports 844×390 and 568×320. The phone camera intentionally fits the playing surface and goals instead of the garage/referee, increasing usable pitch size. The regular test suite covers selection, online mirrors/rematches and mobile projection; inspect animation in the browser after changing the adapter or rig.
