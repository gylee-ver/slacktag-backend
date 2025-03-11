import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

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
        console.error(error);
        res.status(500).json({ message: "오류 발생!" });
    }
});

app.listen(3000, () => console.log("서버 실행 중..."));