// Crops include alpha>=8 shadows. Anchors use the opaque artwork, not padding.
export const FACE_ATLAS = Object.freeze({
  key: "pudding.face-parts", url: "./assets/face-parts.png",
  expectedWidth: 1448, expectedHeight: 1086,
});
export const FACE_PARTS = {
  "eyes": {
    "normal": {
      "left": {
        "rect": [
          41,
          208,
          154,
          152
        ],
        "anchor": [
          0.4318,
          0.4441
        ]
      },
      "right": {
        "rect": [
          223,
          208,
          155,
          153
        ],
        "anchor": [
          0.4226,
          0.4412
        ]
      }
    },
    "wide": {
      "left": {
        "rect": [
          417,
          175,
          129,
          198
        ],
        "anchor": [
          0.4496,
          0.4596
        ]
      },
      "right": {
        "rect": [
          571,
          176,
          139,
          195
        ],
        "anchor": [
          0.4317,
          0.4615
        ]
      }
    },
    "closed": {
      "left": {
        "rect": [
          751,
          228,
          126,
          106
        ],
        "anchor": [
          0.4881,
          0.467
        ]
      },
      "right": {
        "rect": [
          922,
          227,
          140,
          102
        ],
        "anchor": [
          0.4393,
          0.4951
        ]
      }
    },
    "tears": {
      "left": {
        "rect": [
          1096,
          188,
          151,
          175
        ],
        "anchor": [
          0.447,
          0.4514
        ]
      },
      "right": {
        "rect": [
          1276,
          188,
          154,
          182
        ],
        "anchor": [
          0.4188,
          0.4341
        ]
      }
    }
  },
  "brows": {
    "normal": {
      "left": {
        "rect": [
          54,
          830,
          127,
          70
        ],
        "anchor": [
          0.5039,
          0.4714
        ]
      },
      "right": {
        "rect": [
          224,
          830,
          133,
          68
        ],
        "anchor": [
          0.4662,
          0.4853
        ]
      }
    },
    "worried": {
      "left": {
        "rect": [
          410,
          798,
          121,
          85
        ],
        "anchor": [
          0.438,
          0.4824
        ]
      },
      "right": {
        "rect": [
          579,
          797,
          117,
          85
        ],
        "anchor": [
          0.4744,
          0.4941
        ]
      }
    },
    "angry": {
      "left": {
        "rect": [
          764,
          830,
          122,
          68
        ],
        "anchor": [
          0.4754,
          0.4853
        ]
      },
      "right": {
        "rect": [
          915,
          829,
          129,
          75
        ],
        "anchor": [
          0.438,
          0.4533
        ]
      }
    },
    "sad": {
      "left": {
        "rect": [
          1112,
          804,
          125,
          88
        ],
        "anchor": [
          0.436,
          0.4659
        ]
      },
      "right": {
        "rect": [
          1281,
          805,
          113,
          85
        ],
        "anchor": [
          0.469,
          0.4706
        ]
      }
    }
  },
  "mouths": {
    "smile": {
      "rect": [
        128,
        555,
        169,
        79
      ],
      "anchor": [
        0.429,
        0.4494
      ]
    },
    "open": {
      "rect": [
        478,
        477,
        156,
        209
      ],
      "anchor": [
        0.4391,
        0.4545
      ]
    },
    "pout": {
      "rect": [
        848,
        560,
        121,
        64
      ],
      "anchor": [
        0.4545,
        0.4766
      ]
    },
    "worry": {
      "rect": [
        1149,
        560,
        231,
        64
      ],
      "anchor": [
        0.461,
        0.4609
      ]
    }
  }
};
