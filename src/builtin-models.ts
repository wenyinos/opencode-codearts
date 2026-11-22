// Snapshot of GET /v1/model/builtin (2026-11-22). Keep every upstream field:
// the proxy persists and exposes this metadata, and /models returns it too.
// Regenerate with: curl the signed endpoint and replace the array.

export const BUILTIN_MODELS: Array<Record<string, unknown>> = [
  {
    "model_id": "GLM-5.2",
    "model_name": "GLM-5.2",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "最新旗舰模型，专为长程任务打造，复杂工程稳定交付",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.05",
        "input_price": "8",
        "cache_price": "2",
        "output_price": "28",
        "status": "0",
        "ratio_display": "0.7x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65536,
    "context_window": 202752
  },
  {
    "model_id": "openpangu-2.0-flash",
    "model_name": "OpenPangu-2.0-Flash",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【2026/11/30 00:00（北京时间）下线】均衡推理效果与性能",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.011",
        "input_price": "0.8",
        "cache_price": "0.2",
        "output_price": "1.6",
        "status": "0",
        "ratio_display": "0.32x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65535,
    "context_window": 524288
  },
  {
    "model_id": "openpangu-2.0-pro",
    "model_name": "OpenPangu-2.0-Pro",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【2026/11/30 00:00（北京时间）下线】最新旗舰模型，专为长程任务打通，复杂工程稳定交付",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": 32000,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.028",
        "input_price": "3.2",
        "cache_price": "0.8",
        "output_price": "14.5",
        "status": "0",
        "ratio_display": "0.7x",
        "time_slot_id": null,
        "before_display_ratio": null
      },
      {
        "input_from": 32001,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.028",
        "input_price": "4.8",
        "cache_price": "1.2",
        "output_price": "17.6",
        "status": "0",
        "ratio_display": "0.7x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65535,
    "context_window": 524288
  },
  {
    "model_id": "openpangu-2.1-pro",
    "model_name": "OpenPangu-2.1-Pro",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "最新模型，擅长鸿蒙APP开发和昇腾算子生成，Agent 开发、AI 编码、推理优化全面升级",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.05",
        "input_price": "0.8",
        "cache_price": "0.016",
        "output_price": "3.2",
        "status": "0",
        "ratio_display": "0.07x",
        "time_slot_id": null,
        "before_display_ratio": ""
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65535,
    "context_window": 524288
  },
  {
    "model_id": "glm-5.3",
    "model_name": "GLM-5.3",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【限时体验】面向复杂编程与长程任务",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0443",
        "input_price": "8",
        "cache_price": "2",
        "output_price": "28",
        "status": "0",
        "ratio_display": "0.79x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "glm-5.3-flash",
    "model_name": "GLM-5.3-Flash",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【限时体验】强推理低开销，任务高效执行",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0443",
        "input_price": "0.8",
        "cache_price": "0.23",
        "output_price": "2.8",
        "status": "0",
        "ratio_display": "0.08x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": true,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "glm-5.2-sft-harmony",
    "model_name": "GLM-5.2-ArkTS-SPARK",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "基于GLM-5.2增训鸿蒙代码与开发知识",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.05",
        "input_price": "8",
        "cache_price": "2",
        "output_price": "28",
        "status": "0",
        "ratio_display": "0.7x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65535,
    "context_window": 202752
  },
  {
    "model_id": "deepseek-v4.1-flash",
    "model_name": "DeepSeek-V4.1-Flash",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【2026/11/30 00:00（北京时间）下线】【限时体验】能力更高, 速度更快",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.05",
        "input_price": "2",
        "cache_price": "0.2",
        "output_price": "8",
        "status": "0",
        "ratio_display": "0.18x",
        "time_slot_id": "default",
        "before_display_ratio": null
      },
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.05",
        "input_price": "1",
        "cache_price": "0.1",
        "output_price": "4",
        "status": "0",
        "ratio_display": "0.09x",
        "time_slot_id": "off_peak",
        "before_display_ratio": "0.18x"
      }
    ],
    "time_slots": {
      "off_peak": {
        "timezone": "Asia/Shanghai",
        "schedule": "0 0 21 * * *",
        "duration": 11,
        "timeunit": "hour",
        "notice": {
          "zh_cn": "错峰时段5折优惠，积分消耗速度从0.18x降至0.09x（每晚21:00-次日7:59）",
          "en_us": "Off-peak period 50% discount: credit consumption rate reduced from 0.18x to 0.09x (every night from 21:00 to 07:59 next day)"
        }
      },
      "default": {
        "timezone": "Asia/Shanghai",
        "schedule": null,
        "duration": null,
        "timeunit": "hour",
        "notice": {
          "zh_cn": "错峰时段5折优惠，积分消耗速度从0.18x降至0.09x（每晚21:00-次日7:59）",
          "en_us": "Off-peak period 50% discount: credit consumption rate reduced from 0.18x to 0.09x (every night from 21:00 to 07:59 next day)"
        }
      }
    },
    "intervals": [],
    "supports_images": true,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "deepseek-v4.1-flash-1017",
    "model_name": "DeepSeek-V4.1-Flash-1017",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【限时体验】许愿式编程一键成真",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0486",
        "input_price": "2",
        "cache_price": "0.2",
        "output_price": "8",
        "status": "0",
        "ratio_display": "0.18x",
        "time_slot_id": "default",
        "before_display_ratio": null
      },
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0365",
        "input_price": "1",
        "cache_price": "0.1",
        "output_price": "4",
        "status": "0",
        "ratio_display": "0.12x",
        "time_slot_id": "off_peak",
        "before_display_ratio": "0.18x"
      }
    ],
    "time_slots": {
      "off_peak": {
        "timezone": "Asia/Shanghai",
        "schedule": "0 0 21 * * *",
        "duration": 11,
        "timeunit": "hour",
        "notice": {
          "zh_cn": "错峰时段折扣优惠，积分消耗速度从0.18x降至0.12x（每晚21:00-次日7:59）",
          "en_us": "Off-peak period discount: credit consumption rate reduced from 0.18x to 0.12x (every night from 21:00 to 07:59 next day)"
        }
      },
      "default": {
        "timezone": "Asia/Shanghai",
        "schedule": null,
        "duration": null,
        "timeunit": "hour",
        "notice": {
          "zh_cn": "错峰时段折扣优惠，积分消耗速度从0.18x降至0.12x（每晚21:00-次日7:59）",
          "en_us": "Off-peak period discount: credit consumption rate reduced from 0.18x to 0.12x (every night from 21:00 to 07:59 next day)"
        }
      }
    },
    "intervals": [],
    "supports_images": true,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "kimi-k3",
    "model_name": "Kimi-K3",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【限时体验】均衡深度思考与响应速度，复杂任务从容应对",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0368",
        "input_price": "20",
        "cache_price": "2",
        "output_price": "100",
        "status": "0",
        "ratio_display": "2.38x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": true,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "kimi-k3.1-pro",
    "model_name": "Kimi-K3.1-Pro",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "【限时体验】为编程与智能体而生，深度与速度兼得",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0349",
        "input_price": "13",
        "cache_price": "1.3",
        "output_price": "68",
        "status": "0",
        "ratio_display": "1.63x",
        "time_slot_id": null,
        "before_display_ratio": null
      }
    ],
    "time_slots": {},
    "intervals": [],
    "supports_images": true,
    "max_tokens": 65536,
    "context_window": 1048576
  },
  {
    "model_id": "speed",
    "model_name": "智速模式",
    "model_category": "文本生成",
    "enable": true,
    "display_enabled": true,
    "model_desc": "根据任务选择合适模型，并优化Agent执行过程，帮助你更快完成开发任务。",
    "model_sku": null,
    "provider": "internal",
    "channel_source": "codearts",
    "credit": [
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0486",
        "input_price": "2",
        "cache_price": "0.2",
        "output_price": "8",
        "status": "0",
        "ratio_display": "0.18x",
        "time_slot_id": "default",
        "before_display_ratio": null
      },
      {
        "input_from": 0,
        "input_to": -1,
        "output_from": 0,
        "output_to": -1,
        "ratio": "0.0365",
        "input_price": "1",
        "cache_price": "0.1",
        "output_price": "4",
        "status": "0",
        "ratio_display": "0.12x",
        "time_slot_id": "off_peak",
        "before_display_ratio": "0.18x"
      }
    ],
    "time_slots": {
      "off_peak": {
        "timezone": "Asia/Shanghai",
        "schedule": "0 0 21 * * *",
        "duration": 11,
        "timeunit": "hour",
        "notice": null
      },
      "default": {
        "timezone": "Asia/Shanghai",
        "schedule": null,
        "duration": null,
        "timeunit": "hour",
        "notice": null
      }
    },
    "intervals": [],
    "supports_images": false,
    "max_tokens": 65536,
    "context_window": 1048576
  }
]
