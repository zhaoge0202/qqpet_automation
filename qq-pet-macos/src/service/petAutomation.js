/**
 * QQ 宠物全自动管家 Pro (Pet Automation Engine)
 *
 * 核心能力：
 * 1. 生命安全兜底：自动对症吃药（含复活）、自动喂食、自动清洁、自动逗玩
 * 2. 智能商城补货：背包无药/无食物时，自动利用打工赚取的元宝在商城购买并使用
 * 3. 自动日程调度：自动选课升学、自动寻找最高收益岗位打工、自动结算
 * 4. 自动副业钓鱼：体力自动恢复与出海捕捞变现
 */

const { shop } = require("../windows/util/pet/shop.js");

// 疾病与药物映射 (疾名 -> 药品shop key)
const ILLNESS_MEDICINE_MAP = {
  "咳嗽": "10003",       // 枇杷糖浆 (50元宝)
  "支气管炎": "20003",     // 甘草剂 (100元宝)
  "哮喘": "30003",       // 定喘丸 (150元宝)
  "肺结核": "40003",     // 通风散 (200元宝)
  "感冒": "10001",       // 板蓝根 (50元宝)
  "发烧": "30004",       // 退烧药 (100元宝)
  "重感冒": "20001",     // 银翘丸 (150元宝)
  "肺炎": "30001",       // 金色消炎药水 (200元宝)
  "肚子胀": "10002",     // 消食片 (50元宝)
  "胃炎": "20002",       // 蓝色消炎药水 (100元宝)
  "胃溃疡": "30002",     // 龙胆草 (150元宝)
  "胃癌": "40002",       // 仙人汤 (200元宝)
  "死亡": "60001"        // 还魂丹 (400元宝)
};

const SUBJECT_KEYS = [
  "chinese", "mathematics", "politics", "music",
  "art", "manner", "pe", "labouring", "wushu"
];

class PetAutomation {
  constructor() {
    this._timer = null;
    this._lastActionTime = 0;
    this._cycleCount = 0;
  }

  get config() {
    const sys = typeof getSys === "function" ? getSys() : {};
    return {
      enabled: sys.autoPilotEnabled !== false, // 默认开启
      autoCare: sys.autoCare !== false,
      autoBuy: sys.autoBuy !== false,
      mode: sys.autoPilotMode || "balanced", // balanced | work | study
      autoFish: sys.autoFish !== false,
    };
  }

  start() {
    if (this._timer) clearInterval(this._timer);
    // 每 20 秒执行一次自动巡检与调度
    this._timer = setInterval(() => this.tick(), 20000);
    setTimeout(() => this.tick(), 3000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  tick() {
    try {
      if (!this.config.enabled) return;
      if (typeof getPetInfo !== "function" || !global.petControl) return;

      const petInfo = getPetInfo();
      if (!petInfo || !petInfo.info) return;

      // 阶段 1：最高优先级 —— 保命防死与日常补给
      if (this.config.autoCare) {
        const cared = this.handleCare(petInfo);
        if (cared) return; // 刚刚进行了急救或喂食，等待状态更新
      }

      // 如果当前死亡或生病，暂不安排劳务
      if (+petInfo.info.health === 0 || petInfo.activeOption?.ill) return;

      // 阶段 2：任务调度 —— 打工与升学状态机
      this.handleSchedule(petInfo);

      // 阶段 3：副业收益 —— 自动钓鱼
      if (this.config.autoFish) {
        this.handleFishing(petInfo);
      }
    } catch (err) {
      console.error("[PetAutomation] Tick error:", err);
    }
  }

  /**
   * 生命照护与自动补给
   */
  handleCare(petInfo) {
    const info = petInfo.info || {};
    const maxInfo = petInfo.maxInfo || {};
    const activeOption = petInfo.activeOption || {};
    const goods = global.petControl?.Goods;
    if (!goods) return false;

    const store = goods.storeGoods || getCache("store") || { food: [], commodity: [], medicine: [] };
    const isDead = +info.health === 0 || activeOption.ill?.name === "死亡" || activeOption.ill?.type === "dead";

    // 1. 疾病与死亡救治 (最高级)
    const ill = activeOption.ill;
    if (ill || isDead) {
      const illName = isDead ? "死亡" : (ill?.name || "");
      const medId = ILLNESS_MEDICINE_MAP[illName] || "60001";
      const medKey = `_${medId}`;

      // 查背包是否有该药
      let storeMed = (store.medicine || []).find(m => m.startsWith(medKey));
      if (!storeMed && this.config.autoBuy) {
        // 商城自购
        goods.buy(`medicine*${medKey}`);
        storeMed = (goods.storeGoods?.medicine || []).find(m => m.startsWith(medKey));
      }

      if (storeMed) {
        const itemInfo = goods.getGoodsInfo({ goodName: `medicine*${storeMed}` });
        if (itemInfo) {
          goods.useConsumables(itemInfo);
          this.notify(`已对症使用【${itemInfo.name}】，恢复健康！`);
          return true;
        }
      } else if (isDead) {
        // 终极保底救命（即使没元宝也避免永久停尸）
        setPetInfo({
          info: { ...info, health: 5, hunger: Math.max(+info.hunger || 0, 2000), clean: Math.max(+info.clean || 0, 2000), mood: 800 },
          activeOption: { ill: null, die: null }
        });
        this.notify("触发紧急元神重聚，企鹅恢复健康！");
        return true;
      }
    }

    // 2. 饥饿补充 (饥饿值低于 1400 自动吃)
    const hungerMax = maxInfo.hunger || 3100;
    if (info.hunger < Math.min(1400, hungerMax - 300)) {
      let foodList = store.food || [];
      if (foodList.length > 0) {
        const itemInfo = goods.getGoodsInfo({ goodName: `food*${foodList[0]}` });
        if (itemInfo) {
          goods.useConsumables(itemInfo);
          return true;
        }
      } else if (this.config.autoBuy) {
        // 优先买跳跳玉米鱼 (40元宝 +720)；元宝少则买圈圈冰激凌 (5元宝 +90)
        const yb = +info.yb || 0;
        const buyKey = yb >= 40 ? "food*_102010002" : "food*_102010001";
        const buyRes = goods.buy(buyKey);
        if (buyRes?.ok) {
          foodList = goods.storeGoods?.food || [];
          if (foodList.length > 0) {
            const itemInfo = goods.getGoodsInfo({ goodName: `food*${foodList[foodList.length - 1]}` });
            if (itemInfo) {
              goods.useConsumables(itemInfo);
              return true;
            }
          }
        }
      }
    }

    // 3. 清洁补充 (清洁值低于 1400 自动洗)
    const cleanMax = maxInfo.clean || 3100;
    if (info.clean < Math.min(1400, cleanMax - 300)) {
      let commList = store.commodity || [];
      if (commList.length > 0) {
        const itemInfo = goods.getGoodsInfo({ goodName: `commodity*${commList[0]}` });
        if (itemInfo) {
          goods.useConsumables(itemInfo);
          return true;
        }
      } else if (this.config.autoBuy) {
        const buyRes = goods.buy("commodity*_102020001"); // 震动减肥仪 (20元宝 +720)
        if (buyRes?.ok) {
          commList = goods.storeGoods?.commodity || [];
          if (commList.length > 0) {
            const itemInfo = goods.getGoodsInfo({ goodName: `commodity*${commList[commList.length - 1]}` });
            if (itemInfo) {
              goods.useConsumables(itemInfo);
              return true;
            }
          }
        }
      }
    }

    // 4. 心情低落抚慰 (低于 600 自动抚慰)
    if (info.mood < 600) {
      if (typeof addPetInfo === "function") {
        addPetInfo({ mood: 100 });
      }
    }

    return false;
  }

  /**
   * 自动日程调度：打工与升学
   */
  handleSchedule(petInfo) {
    const activeOption = petInfo.activeOption || {};
    const goods = global.petControl?.Goods;
    if (!goods) return;

    // 如果已经在打工、学习或旅行中，不重复安排
    if (activeOption.work || activeOption.study || activeOption.trip) {
      return;
    }

    // 在开启打工或学习前，确保饱腹与清洁充足，避免打工过程中消耗过大
    if (petInfo.info.hunger < 800 || petInfo.info.clean < 800) {
      return;
    }

    const mode = this.config.mode;
    this._cycleCount++;

    // 策略决策
    if (mode === "study" || (mode === "balanced" && this._cycleCount % 2 === 1)) {
      const studyStarted = this.tryStartStudy(petInfo, goods);
      if (studyStarted) return;
    }

    // 默认或打工策略：寻找最佳收益岗位打工
    this.tryStartBestWork(petInfo, goods);
  }

  /**
   * 寻找最高收益工种打工
   */
  tryStartBestWork(petInfo, goods) {
    const level = petInfo.maxInfo?.level || 1;
    const studyValues = petInfo.activeValue?.study || {};

    const availableWorks = [];
    for (const [key, w] of Object.entries(shop.work || {})) {
      // 等级检查
      if (w.need && level < w.need) continue;

      // 学历与属性要求检查
      let eduPass = true;
      if (w.education) {
        for (const [subj, needHours] of Object.entries(w.education)) {
          if ((studyValues[subj] || 0) < needHours) {
            eduPass = false;
            break;
          }
        }
      }
      if (!eduPass) continue;

      const rate = (w.yb || 0) / (w.useTime || 30);
      availableWorks.push({ key, rate, work: w });
    }

    if (availableWorks.length === 0) return false;

    // 按每分钟元宝产出降序排序，选最优
    availableWorks.sort((a, b) => b.rate - a.rate);
    const best = availableWorks[0];

    const workInfo = goods.getWorkInfo({ goodName: `work*${best.key}` });
    if (workInfo) {
      goods.activeWork(workInfo);
      this.notify(`自动前往【${best.work.name}】打工（预计赚取 ${best.work.yb} 元宝）`);
      return true;
    }
    return false;
  }

  /**
   * 寻找未完成的科目自动上学
   */
  tryStartStudy(petInfo, goods) {
    const studyValues = petInfo.activeValue?.study || {};

    // 找出课时最少的一门科目进行进修
    let candidateKey = null;
    let minHours = Infinity;

    for (const subj of SUBJECT_KEYS) {
      const hours = studyValues[subj] || 0;
      if (hours < 95 && hours < minHours) { // 95 为研究生毕业课时上限
        minHours = hours;
        candidateKey = subj;
      }
    }

    if (!candidateKey) return false;

    // 根据当前课时决定所选学阶
    let prefix = "xx";
    if (minHours >= 40) prefix = "yjs";
    else if (minHours >= 20) prefix = "dx";
    else if (minHours >= 9) prefix = "zx";

    const studyKey = `_${prefix}-${candidateKey}`;
    const studyInfo = goods.getStudyInfo({ goodName: `study*${studyKey}` });
    if (studyInfo) {
      goods.activeStudy(studyInfo);
      this.notify(`自动前往修读【${studyInfo.school}${studyInfo.object}】课程~`);
      return true;
    }
    return false;
  }

  /**
   * 自动副业钓鱼
   */
  handleFishing(petInfo) {
    const fishing = petInfo.fishing || {};
    const power = fishing.power || 0;

    // 体力充足时（>= 20 点），自动进行模拟捕鱼与变现
    if (power >= 20) {
      const caughtCount = Math.floor(Math.random() * 3) + 1; // 捕获 1-3 条
      const ybGain = caughtCount * 8; // 每条鱼兑换 8 元宝
      const newYb = (+petInfo.info.yb || 0) + ybGain;

      setPetInfo({
        info: { yb: newYb },
        fishing: {
          ...fishing,
          power: Math.max(0, power - 15),
          harvestfish: (fishing.harvestfish || 0) + caughtCount
        }
      });
      console.log(`[PetAutomation] Auto fishing: +${caughtCount} fish, +${ybGain} yb`);
    } else {
      // 随着时间自然恢复体力（最多 30 点）
      if (power < 30) {
        setPetInfo({
          fishing: {
            ...fishing,
            power: Math.min(30, power + 1)
          }
        });
      }
    }
  }

  notify(msg) {
    if (typeof openSpeak === "function") {
      openSpeak({
        data: { type: "text", data: `[host]，${msg}` },
        active: "speak"
      });
    }
  }
}

global.petAutomation = new PetAutomation();
module.exports = { PetAutomation };
