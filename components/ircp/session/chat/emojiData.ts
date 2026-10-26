// A compact emoji set for the chat picker (no dependency): each entry is "emoji keywords...", and the
// keywords are what the picker's search matches.
export type EmojiCategory = { id: string; label: string; emojis: { char: string; keywords: string }[] }

function parse(list: string[]) {
    return list.map(entry => {
        const space = entry.indexOf(' ')
        return { char: entry.slice(0, space), keywords: entry.slice(space + 1) }
    })
}

export const emojiCategories: EmojiCategory[] = [
    {
        id: 'smileys',
        label: 'Smileys',
        emojis: parse([
            '😀 grin happy smile', '😃 smile happy joy', '😄 laugh smile happy', '😁 grin beam teeth', '😆 laugh squint lol',
            '😅 sweat relief nervous', '🤣 rofl rolling laugh', '😂 joy tears laugh lol', '🙂 slight smile', '🙃 upside down silly',
            '😉 wink', '😊 blush smile happy', '😇 angel innocent halo', '🥰 love hearts adore', '😍 heart eyes love',
            '🤩 star struck wow', '😘 kiss blow', '😋 yum tasty', '😛 tongue playful', '😜 wink tongue crazy',
            '🤪 zany crazy goofy', '🤑 money rich', '🤗 hug hugging', '🤭 oops giggle hand', '🤫 shush quiet secret',
            '🤔 think thinking hmm', '🤐 zip mouth secret', '🤨 raised eyebrow skeptical', '😐 neutral meh', '😑 expressionless blank',
            '😶 no mouth speechless', '😏 smirk', '😒 unamused annoyed', '🙄 eye roll', '😬 grimace awkward',
            '😌 relieved calm', '😔 pensive sad', '😪 sleepy tired', '😴 sleep zzz', '😷 mask sick',
            '🤒 thermometer ill', '🤯 mind blown exploding', '🥳 party celebrate', '😎 cool sunglasses', '🤓 nerd geek',
            '🧐 monocle inspect', '😕 confused', '😟 worried', '🙁 frown sad', '😮 open mouth surprised wow',
            '😲 astonished shocked', '😳 flushed embarrassed', '🥺 pleading puppy eyes', '😢 cry sad tear', '😭 sob crying',
            '😱 scream fear', '😖 confounded', '😞 disappointed', '😓 downcast sweat', '😩 weary tired',
            '😫 tired exhausted', '🥱 yawn bored', '😤 triumph huff', '😡 angry rage mad', '🤬 cursing swear',
            '😈 devil smiling', '💀 skull dead', '🤡 clown', '👻 ghost boo', '🤖 robot bot ai',
        ]),
    },
    {
        id: 'gestures',
        label: 'Gestures',
        emojis: parse([
            '👍 thumbs up yes ok like agree', '👎 thumbs down no dislike', '👌 ok perfect', '✌️ peace victory', '🤞 fingers crossed luck',
            '🤟 love you', '🤘 rock horns', '🤙 call me shaka', '👈 point left', '👉 point right',
            '👆 point up', '👇 point down', '☝️ index up one', '✋ hand stop raise', '🤚 raised back hand',
            '🖐️ hand fingers', '🖖 vulcan spock', '👋 wave hello hi bye', '👏 clap applause', '🙌 raised hands hooray',
            '👐 open hands', '🤲 palms up', '🤝 handshake deal agree', '🙏 pray please thanks', '✍️ writing',
            '💪 muscle strong flex', '🧠 brain smart', '👀 eyes look see watching', '👁️ eye', '🫡 salute respect',
            '🫶 heart hands love', '🤌 pinched italian', '🫠 melting', '🙋 raising hand question', '🙇 bow sorry',
            '🤷 shrug dunno', '🤦 facepalm', '🙆 ok gesture', '🙅 no gesture', '💁 info desk',
        ]),
    },
    {
        id: 'hearts',
        label: 'Hearts',
        emojis: parse([
            '❤️ red heart love', '🧡 orange heart', '💛 yellow heart', '💚 green heart', '💙 blue heart',
            '💜 purple heart', '🖤 black heart', '🤍 white heart', '🤎 brown heart', '💔 broken heart',
            '❣️ heart exclamation', '💕 two hearts', '💞 revolving hearts', '💓 beating heart', '💗 growing heart',
            '💖 sparkling heart', '💘 cupid arrow', '💝 heart ribbon gift', '💯 hundred perfect score', '💢 anger',
            '💥 boom collision', '💫 dizzy', '💦 sweat drops', '💨 dash fast', '💬 speech bubble chat',
            '💭 thought bubble', '🗯️ angry bubble', '💤 zzz sleep',
        ]),
    },
    {
        id: 'celebration',
        label: 'Celebrate',
        emojis: parse([
            '🎉 party tada celebrate', '🎊 confetti', '🎈 balloon', '🎂 birthday cake', '🎁 gift present',
            '🏆 trophy win winner', '🥇 gold medal first', '🥈 silver medal', '🥉 bronze medal', '🏅 medal',
            '⭐ star', '🌟 glowing star', '✨ sparkles shine', '🔥 fire hot lit', '⚡ lightning zap fast',
            '🚀 rocket launch ship', '🎯 target bullseye goal', '🎮 game controller', '🎧 headphones music', '🎵 music note',
            '🎬 movie clapper', '📸 camera photo', '🪄 magic wand', '🧩 puzzle piece', '🎲 dice game',
        ]),
    },
    {
        id: 'work',
        label: 'Work',
        emojis: parse([
            '💡 idea bulb', '📌 pin', '📎 paperclip attach', '📝 memo note write', '📋 clipboard',
            '📅 calendar date', '⏰ alarm clock time', '⏳ hourglass wait', '⌛ hourglass done', '🕒 clock three',
            '💻 laptop computer', '🖥️ desktop screen monitor', '⌨️ keyboard', '🖱️ mouse', '📱 phone mobile',
            '🔒 lock secure locked', '🔓 unlock open', '🔑 key password', '🛡️ shield secure protect', '🔐 locked key encrypted',
            '📊 chart bar stats', '📈 chart up growth', '📉 chart down', '🗂️ folders', '📁 folder file',
            '📤 outbox upload send', '📥 inbox download', '📧 email mail', '🔗 link chain', '🔍 search magnify',
            '🧪 test lab', '🐛 bug', '🛠️ tools fix build', '⚙️ gear settings', '🧭 compass direction',
            '📚 books study', '✏️ pencil', '🖊️ pen', '📏 ruler', '🎓 graduation exam',
        ]),
    },
    {
        id: 'symbols',
        label: 'Symbols',
        emojis: parse([
            '✅ check done yes tick', '☑️ ballot check', '✔️ check mark', '❌ cross no wrong', '❎ cross box',
            '⚠️ warning caution', '🚫 prohibited no', '⛔ no entry', '❗ exclamation important', '❓ question',
            '❔ white question', '❕ white exclamation', '‼️ double exclamation', '⁉️ interrobang', '🔴 red circle',
            '🟠 orange circle', '🟡 yellow circle', '🟢 green circle online', '🔵 blue circle', '🟣 purple circle',
            '⚫ black circle', '⚪ white circle', '🔺 red triangle up', '🔻 red triangle down', '➕ plus add',
            '➖ minus', '✖️ multiply', '➗ divide', '♻️ recycle', '🆗 ok button',
            '🆕 new', '🆒 cool', '🔝 top', '🔜 soon', '⏩ fast forward',
            '⏸️ pause', '▶️ play', '⏹️ stop', '🔁 repeat', '🔄 refresh sync',
        ]),
    },
    {
        id: 'nature',
        label: 'Nature',
        emojis: parse([
            '🐶 dog puppy pet', '🐱 cat kitten', '🐭 mouse', '🐹 hamster', '🐰 rabbit bunny',
            '🦊 fox', '🐻 bear', '🐼 panda', '🐨 koala', '🐯 tiger',
            '🦁 lion', '🐮 cow', '🐷 pig', '🐸 frog', '🐵 monkey',
            '🐔 chicken', '🐧 penguin', '🐦 bird', '🦉 owl', '🦄 unicorn',
            '🐝 bee', '🦋 butterfly', '🐢 turtle slow', '🐙 octopus', '🐳 whale',
            '🌱 seedling grow', '🌳 tree', '🌵 cactus', '🌸 blossom flower', '🌻 sunflower',
            '🌈 rainbow', '☀️ sun sunny', '🌙 moon night', '⛅ cloud sun', '🌧️ rain',
            '❄️ snow cold', '🌊 wave ocean', '🌍 earth globe world', '🪐 planet', '☕ coffee tea',
            '🍕 pizza', '🍔 burger', '🍟 fries', '🍩 donut', '🍪 cookie',
            '🍎 apple', '🍉 watermelon', '🍿 popcorn', '🥤 drink', '🍰 cake',
        ]),
    },
]

export const allEmojis = emojiCategories.flatMap(category => category.emojis)
