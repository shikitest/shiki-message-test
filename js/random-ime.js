(function () {
    "use strict";

    // ============================================================
    // Random Flick IME
    //
    // 第一阶段目标：
    // 1. 不预先决定句意
    // 2. 不依赖自定义回复词库
    // 3. 从 Flick 假名输入行为开始
    // 4. 候选只是输入法建议，角色可以完全无视
    // 5. 最终文本由输入过程自己生长出来
    // ============================================================

    const VERSION = "0.1.0";

    // ============================================================
    // 基础设置
    // ============================================================

    const DEFAULT_OPTIONS = {
        minLength: 1,
        maxLength: 18,

        // 每确认一个片段之后，继续输入的基础概率
        continueChance: 0.68,

        // 当前读音存在汉字候选时，打开候选栏的概率
        candidateChance: 0.62,

        // 打开候选栏以后，最终选择转换候选的概率
        chooseCandidateChance: 0.72,

        // 没选汉字时，转成片假名的概率
        katakanaChance: 0.08,

        // 偶尔删除最后一个字符
        backspaceChance: 0.08,

        // 每次输入一个片段时，最大假名长度
        minSegmentKana: 1,
        maxSegmentKana: 4,

        // 防止随机状态机跑太久
        maxSteps: 120,

        debug: true
    };

    // ============================================================
    // Flick 键盘
    //
    // 使用：
    // center = 点按
    // left / up / right / down = 四方向 Flick
    //
    // 日语 12 键 Flick 的核心是：
    // 一行假名由一个主键 + 四方向产生。
    // ============================================================

    const FLICK_KEYS = [
        {
            key: "あ",
            center: "あ",
            left: "い",
            up: "う",
            right: "え",
            down: "お"
        },
        {
            key: "か",
            center: "か",
            left: "き",
            up: "く",
            right: "け",
            down: "こ"
        },
        {
            key: "さ",
            center: "さ",
            left: "し",
            up: "す",
            right: "せ",
            down: "そ"
        },
        {
            key: "た",
            center: "た",
            left: "ち",
            up: "つ",
            right: "て",
            down: "と"
        },
        {
            key: "な",
            center: "な",
            left: "に",
            up: "ぬ",
            right: "ね",
            down: "の"
        },
        {
            key: "は",
            center: "は",
            left: "ひ",
            up: "ふ",
            right: "へ",
            down: "ほ"
        },
        {
            key: "ま",
            center: "ま",
            left: "み",
            up: "む",
            right: "め",
            down: "も"
        },
        {
            key: "や",
            center: "や",
            left: "（",
            up: "ゆ",
            right: "）",
            down: "よ"
        },
        {
            key: "ら",
            center: "ら",
            left: "り",
            up: "る",
            right: "れ",
            down: "ろ"
        },
        {
            key: "わ",
            center: "わ",
            left: "を",
            up: "ん",
            right: "ー",
            down: "〜"
        }
    ];

    const FLICK_DIRECTIONS = [
        "center",
        "left",
        "up",
        "right",
        "down"
    ];

    // ============================================================
    // 小字 / 浊音 / 半浊音
    //
    // 这一阶段先模拟成“输入后再做一次变换”。
    // 后面可以进一步模拟真实键盘上的小字/浊音键操作。
    // ============================================================

    const KANA_VARIANTS = {
        "か": ["が"],
        "き": ["ぎ"],
        "く": ["ぐ"],
        "け": ["げ"],
        "こ": ["ご"],

        "さ": ["ざ"],
        "し": ["じ"],
        "す": ["ず"],
        "せ": ["ぜ"],
        "そ": ["ぞ"],

        "た": ["だ"],
        "ち": ["ぢ"],
        "つ": ["づ", "っ"],
        "て": ["で"],
        "と": ["ど"],

        "は": ["ば", "ぱ"],
        "ひ": ["び", "ぴ"],
        "ふ": ["ぶ", "ぷ"],
        "へ": ["べ", "ぺ"],
        "ほ": ["ぼ", "ぽ"],

        "や": ["ゃ"],
        "ゆ": ["ゅ"],
        "よ": ["ょ"],

        "あ": ["ぁ"],
        "い": ["ぃ"],
        "う": ["ぅ"],
        "え": ["ぇ"],
        "お": ["ぉ"],

        "わ": ["ゎ"]
    };

    // ============================================================
    // 第一阶段小型 IME 候选库
    //
    // 注意：
    // 这不是角色“能说什么”的词库。
    //
    // 它只是：
    // 输入这个读音时，虚拟 IME 可以提供什么候选。
    //
    // 后面会单独扩展成大型 ime-dictionary.js / json。
    // ============================================================

    const IME_DICTIONARY = {
        "あい": ["愛", "藍"],
        "あう": ["会う", "合う"],
        "あお": ["青"],
        "あか": ["赤"],
        "あさ": ["朝"],
        "あし": ["足"],
        "あした": ["明日"],
        "あつい": ["暑い", "熱い"],
        "あと": ["後", "あと"],
        "あめ": ["雨", "飴"],

        "いえ": ["家"],
        "いく": ["行く"],
        "いま": ["今"],
        "いみ": ["意味"],
        "いる": ["居る", "いる"],

        "うえ": ["上"],
        "うみ": ["海"],
        "うれしい": ["嬉しい"],

        "え": ["絵"],
        "えき": ["駅"],

        "おと": ["音"],
        "おもう": ["思う"],
        "おもしろい": ["面白い"],

        "かお": ["顔"],
        "かみ": ["神", "紙", "髪"],
        "かわ": ["川"],
        "かわいい": ["可愛い", "かわいい"],
        "き": ["木", "気"],
        "きょう": ["今日", "京"],
        "きる": ["着る", "切る"],
        "くる": ["来る"],
        "くろ": ["黒"],

        "ここ": ["ここ"],
        "こと": ["事", "こと"],
        "こえ": ["声"],
        "こわい": ["怖い"],

        "さかな": ["魚"],
        "さむい": ["寒い"],
        "しろ": ["白"],
        "すき": ["好き"],
        "すごい": ["凄い", "すごい"],

        "そら": ["空"],
        "それ": ["それ"],

        "たべる": ["食べる"],
        "たのしい": ["楽しい"],
        "だめ": ["駄目", "ダメ"],
        "ちょっと": ["ちょっと"],
        "つき": ["月"],
        "つよい": ["強い"],

        "て": ["手"],
        "てんき": ["天気"],

        "とき": ["時"],
        "ともだち": ["友達"],

        "なに": ["何"],
        "なん": ["何", "なん"],
        "なんか": ["なんか"],
        "ねこ": ["猫"],
        "ねむい": ["眠い"],

        "はな": ["花", "鼻"],
        "ひと": ["人"],
        "ひる": ["昼"],
        "ほし": ["星", "欲し"],
        "ほん": ["本"],
        "ほんと": ["本当", "ほんと"],

        "まつ": ["待つ"],
        "みる": ["見る", "観る"],
        "みず": ["水"],
        "むり": ["無理"],

        "やばい": ["やばい", "ヤバい"],
        "やる": ["やる"],
        "ゆめ": ["夢"],

        "よる": ["夜"],
        "よむ": ["読む"],

        "わかる": ["分かる", "わかる"],
        "わたし": ["私"]
    };

    // ============================================================
    // 工具函数
    // ============================================================

    function randomItem(array) {
        if (!Array.isArray(array) || array.length === 0) {
            return null;
        }

        return array[
            Math.floor(
                Math.random() * array.length
            )
        ];
    }

    function randomInt(min, max) {
        return Math.floor(
            Math.random() * (max - min + 1)
        ) + min;
    }

    function mergeOptions(options) {
        return Object.assign(
            {},
            DEFAULT_OPTIONS,
            options || {}
        );
    }

    function hiraganaToKatakana(text) {
        return String(text || "").replace(
            /[\u3041-\u3096]/g,
            function (char) {
                return String.fromCharCode(
                    char.charCodeAt(0) + 0x60
                );
            }
        );
    }

    // ============================================================
    // 模拟一次 Flick
    // ============================================================

    function randomFlick() {
        const keyData = randomItem(FLICK_KEYS);
        const direction = randomItem(FLICK_DIRECTIONS);

        let output = keyData[direction];

        // 少量概率对输入出的假名进行浊音/小字等变换
        if (
            output &&
            KANA_VARIANTS[output] &&
            Math.random() < 0.18
        ) {
            output = randomItem(
                KANA_VARIANTS[output]
            );
        }

        return {
            key: keyData.key,
            direction,
            output
        };
    }

    // ============================================================
    // 生成一小段纯 Flick 假名
    // ============================================================

    function createKanaSegment(options, log) {
        const length = randomInt(
            options.minSegmentKana,
            options.maxSegmentKana
        );

        let segment = "";

        for (let i = 0; i < length; i++) {
            const flick = randomFlick();

            segment += flick.output;

            log.push({
                type: "flick",
                key: flick.key,
                direction: flick.direction,
                output: flick.output,
                composition: segment
            });
        }

        return segment;
    }

    // ============================================================
    // 根据当前读音产生候选
    // ============================================================

    function getCandidates(reading) {
        const candidates = [];

        // 原平假名永远存在
        candidates.push({
            text: reading,
            source: "raw-kana"
        });

        // 片假名永远可以作为路径存在
        candidates.push({
            text: hiraganaToKatakana(reading),
            source: "katakana"
        });

        // 如果内部词典有对应转换，再加入
        const dictionaryCandidates =
            IME_DICTIONARY[reading];

        if (Array.isArray(dictionaryCandidates)) {
            dictionaryCandidates.forEach(
                function (text) {
                    candidates.push({
                        text,
                        source: "dictionary"
                    });
                }
            );
        }

        // 去重
        const seen = new Set();

        return candidates.filter(
            function (candidate) {
                if (seen.has(candidate.text)) {
                    return false;
                }

                seen.add(candidate.text);
                return true;
            }
        );
    }

    // ============================================================
    // 随机决定如何确认当前片段
    // ============================================================

    function confirmSegment(
        reading,
        options,
        log
    ) {
        const candidates =
            getCandidates(reading);

        log.push({
            type: "candidate-list",
            reading,
            candidates: candidates.map(
                function (item) {
                    return item.text;
                }
            )
        });

        const dictionaryOnly =
            candidates.filter(
                function (item) {
                    return item.source === "dictionary";
                }
            );

        // 有真实转换候选，并触发候选行为
        if (
            dictionaryOnly.length > 0 &&
            Math.random() <
                options.candidateChance
        ) {
            log.push({
                type: "open-candidates",
                reading
            });

            // 打开候选栏后，也可能最后仍然不转换
            if (
                Math.random() <
                options.chooseCandidateChance
            ) {
                const chosen =
                    randomItem(dictionaryOnly);

                log.push({
                    type: "choose-candidate",
                    reading,
                    text: chosen.text,
                    source: chosen.source
                });

                return chosen.text;
            }
        }

        // 没选汉字时，小概率片假名化
        if (
            Math.random() <
            options.katakanaChance
        ) {
            const katakana =
                hiraganaToKatakana(reading);

            log.push({
                type: "confirm-katakana",
                reading,
                text: katakana
            });

            return katakana;
        }

        // 最常见的兜底：
        // 直接保留原假名
        log.push({
            type: "confirm-kana",
            reading,
            text: reading
        });

        return reading;
    }

    // ============================================================
    // 是否继续输入
    //
    // 越接近 maxLength，
    // 停止概率越高。
    // ============================================================

    function shouldContinue(
        currentLength,
        options
    ) {
        if (
            currentLength <
            options.minLength
        ) {
            return true;
        }

        if (
            currentLength >=
            options.maxLength
        ) {
            return false;
        }

        const progress =
            currentLength /
            options.maxLength;

        const adjustedChance =
            options.continueChance *
            (1 - progress * 0.7);

        return (
            Math.random() <
            adjustedChance
        );
    }

    // ============================================================
    // 主生成器
    // ============================================================

    function generate(options) {
        const config =
            mergeOptions(options);

        const log = [];

        let text = "";
        let steps = 0;
        let keystrokes = 0;

        log.push({
            type: "session-start",
            version: VERSION
        });

        while (
            steps < config.maxSteps &&
            text.length <
                config.maxLength
        ) {
            steps++;

            const reading =
                createKanaSegment(
                    config,
                    log
                );

            keystrokes += reading.length;

                   log.push({
            type: "composition",
            reading
        });

        let confirmed =
            confirmSegment(
                reading,
                config,
                log
            );

        // 防止超过最终字数上限
        const remaining =
            config.maxLength -
            text.length;

        if (
            confirmed.length >
            remaining
        ) {
            confirmed =
                confirmed.slice(
                    0,
                    remaining
                );
        }

        text += confirmed;

        log.push({
            type: "buffer-update",
            text
        });

        // 小概率模拟 Backspace
        if (
            text.length >
                config.minLength &&
            Math.random() <
                config.backspaceChance
        ) {
            const removed =
                text.slice(-1);

            text =
                text.slice(0, -1);

            log.push({
                type: "backspace",
                removed,
                text
            });
        }

        const continueTyping =
            shouldContinue(
                text.length,
                config
            );

        log.push({
            type: "continue-check",
            result:
                continueTyping
        });

        if (!continueTyping) {
            break;
        }
    }

    if (!text) {
        text = "あ";

        log.push({
            type: "fallback",
            text
        });
    }

    log.push({
        type: "send",
        text
    });

    const result = {
        text,
        keystrokes,
        steps,
        log
    };

    if (config.debug) {
        printDebug(result);
    }

    return result;
}

// ============================================================
// Console 调试输出
// ============================================================

function printDebug(result) {
    console.group(
        "[RandomIME] Flick Session"
    );

    result.log.forEach(
        function (event) {
            switch (event.type) {
                case "session-start":
                    console.log(
                        "SESSION START",
                        event.version
                    );
                    break;

                case "flick":
                    console.log(
                        "FLICK",
                        event.key,
                        "→",
                        event.direction,
                        "→",
                        event.output,
                        "| composition:",
                        event.composition
                    );
                    break;

                case "composition":
                    console.log(
                        "COMPOSITION →",
                        event.reading
                    );
                    break;

                case "candidate-list":
                    console.log(
                        "CANDIDATES →",
                        event.candidates
                    );
                    break;

                case "open-candidates":
                    console.log(
                        "OPEN CANDIDATES →",
                        event.reading
                    );
                    break;

                case "choose-candidate":
                    console.log(
                        "SELECT →",
                        event.text
                    );
                    break;

                case "confirm-katakana":
                    console.log(
                        "CONFIRM KATAKANA →",
                        event.text
                    );
                    break;

                case "confirm-kana":
                    console.log(
                        "CONFIRM KANA →",
                        event.text
                    );
                    break;

                case "buffer-update":
                    console.log(
                        "BUFFER →",
                        event.text
                    );
                    break;

                case "backspace":
                    console.log(
                        "BACKSPACE →",
                        event.removed,
                        "| BUFFER →",
                        event.text
                    );
                    break;

                case "continue-check":
                    console.log(
                        "CONTINUE →",
                        event.result
                    );
                    break;

                case "send":
                    console.log(
                        "SEND →",
                        event.text
                    );
                    break;
            }
        }
    );

    console.log(
        "FINAL:",
        result.text
    );

    console.log(
        "KEYSTROKES:",
        result.keystrokes
    );

    console.log(
        "STEPS:",
        result.steps
    );

    console.groupEnd();
}

// ============================================================
// 对外 API
// ============================================================

window.RandomIME = {
    version: VERSION,

    generate,

    getCandidates,

    randomFlick,

    hiraganaToKatakana,

    dictionary: IME_DICTIONARY,

    flickKeys: FLICK_KEYS
};

// ============================================================
// 测试函数
//
// Console:
//
// testRandomIME()
//
// 或：
//
// testRandomIME({
//     minLength: 4,
//     maxLength: 12
// })
// ============================================================

window.testRandomIME =
    function (options) {
        return window.RandomIME.generate(
            options
        );
    };

console.log(
    "[RandomIME] Flick IME 核心已加载，版本",
    VERSION
);

})();
