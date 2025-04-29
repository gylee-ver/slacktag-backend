import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const PORT = process.env.PORT || 3000;  // Render가 자동으로 PORT를 할당할 수 있도록 설정

app.post("/tag-members", async (req, res) => {
    const { messageLink } = req.body;

    // 메시지 링크에서 채널 ID와 timestamp 추출
    const match = messageLink.match(/archives\/(.*?)\/p(\d+)/);
    if (!match) return res.status(400).json({ message: "잘못된 메시지 링크입니다." });

    const channelId = match[1];
    const threadTs = `${match[2].slice(0, -6)}.${match[2].slice(-6)}`;

    try {
        // 채널 멤버 조회
        const membersRes = await axios.get("https://slack.com/api/conversations.members", {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
            params: { channel: channelId }
        });

        if (!membersRes.data.ok) throw new Error("Slack API 호출 실패");

        const members = membersRes.data.members.map(user => `<@${user}>`).join(" ");
        
        // 스레드에 멘션 메시지 추가
        await axios.post("https://slack.com/api/chat.postMessage", {
            channel: channelId,
            thread_ts: threadTs,
            text: `모두를 태그합니다! ${members}`
        }, {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        res.json({ message: "태그 완료!" });

    } catch (error) {
        console.error("오류 발생:", error?.response?.data || error);
        res.status(500).json({ message: "오류 발생!", error: error?.response?.data || error.message });
    }
});

app.post("/tag-unreacted-members", async (req, res) => {
    const { messageLink } = req.body;

    // 메시지 링크에서 채널 ID와 timestamp 추출
    const match = messageLink.match(/archives\/(.*?)\/p(\d+)/);
    if (!match) {
        return res.status(400).json({ message: "잘못된 메시지 링크입니다." });
    }

    const channelId = match[1];
    const threadTs = `${match[2].slice(0, -6)}.${match[2].slice(-6)}`;

    // 제외할 사용자 ID (필요시 수정)
    const excludedUserIds = ['U12345678', 'U87654321'];

    try {
        // 1. 채널 멤버 조회
        const membersRes = await axios.get("https://slack.com/api/conversations.members", {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
            params: { channel: channelId }
        });

        if (!membersRes.data.ok) throw new Error("채널 멤버 조회 실패");

        const allMembers = membersRes.data.members;

        // 2. 메시지 조회 (리액션 정보 포함)
        const messageRes = await axios.get("https://slack.com/api/conversations.history", {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
            params: { channel: channelId, latest: threadTs, inclusive: true, limit: 1 }
        });

        if (!messageRes.data.ok) throw new Error("메시지 조회 실패");

        const message = messageRes.data.messages[0];

        // 3. 리액션한 사용자 수집
        const reactedUserIds = [];
        if (message.reactions) {
            message.reactions.forEach(reaction => {
                reactedUserIds.push(...reaction.users);
            });
        }

        const reactedSet = new Set(reactedUserIds);

        // 4. 반응하지 않은 멤버 필터링
        const unreactedMembers = allMembers.filter(userId => 
            !reactedSet.has(userId) && !excludedUserIds.includes(userId)
        );

        if (unreactedMembers.length === 0) {
            return res.json({ message: "✅ 모두 이모지 반응 완료!" });
        }

        const mentions = unreactedMembers.map(userId => `<@${userId}>`).join(" ");

        // 5. 스레드에 멘션 메시지 작성
        await axios.post("https://slack.com/api/chat.postMessage", {
            channel: channelId,
            thread_ts: threadTs,
            text: `이모지 반응 안 한 사람들: ${mentions}`
        }, {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        res.json({ message: "✅ 반응 안 한 사람 태그 완료!" });

    } catch (error) {
        console.error("오류:", error?.response?.data || error.message);
        res.status(500).json({ message: "서버 오류 발생", error: error?.response?.data || error.message });
    }
});

app.get("/", (req, res) => {
    res.send("백엔드 서버가 정상적으로 실행 중입니다!");
});

app.listen(PORT, () => console.log(`✅ 서버 실행 중 (PORT: ${PORT})`));