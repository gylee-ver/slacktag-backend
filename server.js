import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// 토큰 유효성 검사
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!SLACK_TOKEN) {
    console.error("❌ SLACK_BOT_TOKEN이 설정되지 않았습니다!");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;

// 토큰 테스트 함수
async function testSlackToken() {
    try {
        const response = await axios.get("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
        });
        
        if (!response.data.ok) {
            console.error("❌ Slack 토큰 테스트 실패:", response.data.error);
            return false;
        }
        
        console.log("✅ Slack 토큰 테스트 성공!");
        console.log("봇 사용자:", response.data.user);
        console.log("팀:", response.data.team);
        return true;
    } catch (error) {
        console.error("❌ Slack 토큰 테스트 중 오류:", error.message);
        return false;
    }
}

// 서버 시작 시 토큰 테스트
testSlackToken().then(isValid => {
    if (!isValid) {
        console.error("❌ Slack 토큰이 유효하지 않습니다. 서버를 종료합니다.");
        process.exit(1);
    }
});

app.post("/tag-members", async (req, res) => {
    const { messageLink } = req.body;

    if (!messageLink) {
        return res.status(400).json({ message: "메시지 링크가 필요합니다." });
    }

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

        if (!membersRes.data.ok) {
            console.error("Slack API 호출 실패:", membersRes.data.error);
            throw new Error(`Slack API 호출 실패: ${membersRes.data.error}`);
        }

        const members = membersRes.data.members.map(user => `<@${user}>`).join(" ");
        
        // 스레드에 멘션 메시지 추가
        const postRes = await axios.post("https://slack.com/api/chat.postMessage", {
            channel: channelId,
            thread_ts: threadTs,
            text: `모두를 태그합니다! ${members}`
        }, {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        if (!postRes.data.ok) {
            console.error("메시지 전송 실패:", postRes.data.error);
            throw new Error(`메시지 전송 실패: ${postRes.data.error}`);
        }

        res.json({ message: "태그 완료!" });

    } catch (error) {
        console.error("상세 오류:", {
            message: error.message,
            response: error?.response?.data,
            stack: error.stack
        });
        res.status(500).json({ 
            message: "오류 발생!", 
            error: error?.response?.data?.error || error.message 
        });
    }
});

app.post("/tag-unreacted-members", async (req, res) => {
    const { messageLink } = req.body;

    if (!messageLink) {
        return res.status(400).json({ message: "메시지 링크가 필요합니다." });
    }

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

        if (!membersRes.data.ok) {
            console.error("채널 멤버 조회 실패:", membersRes.data.error);
            throw new Error(`채널 멤버 조회 실패: ${membersRes.data.error}`);
        }

        const allMembers = membersRes.data.members;

        // 2. 메시지 조회 (리액션 정보 포함)
        const messageRes = await axios.get("https://slack.com/api/conversations.history", {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
            params: { channel: channelId, latest: threadTs, inclusive: true, limit: 1 }
        });

        if (!messageRes.data.ok) {
            console.error("메시지 조회 실패:", messageRes.data.error);
            throw new Error(`메시지 조회 실패: ${messageRes.data.error}`);
        }

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
        const postRes = await axios.post("https://slack.com/api/chat.postMessage", {
            channel: channelId,
            thread_ts: threadTs,
            text: `이모지 반응 안 한 사람들: ${mentions}`
        }, {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        if (!postRes.data.ok) {
            console.error("메시지 전송 실패:", postRes.data.error);
            throw new Error(`메시지 전송 실패: ${postRes.data.error}`);
        }

        res.json({ message: "✅ 반응 안 한 사람 태그 완료!" });

    } catch (error) {
        console.error("상세 오류:", {
            message: error.message,
            response: error?.response?.data,
            stack: error.stack
        });
        res.status(500).json({ 
            message: "서버 오류 발생", 
            error: error?.response?.data?.error || error.message 
        });
    }
});

app.get("/", (req, res) => {
    res.send("백엔드 서버가 정상적으로 실행 중입니다!");
});

app.listen(PORT, () => console.log(`✅ 서버 실행 중 (PORT: ${PORT})`));