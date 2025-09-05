package com.demo.chatbot.interfaces;

import com.demo.chatbot.interfaces.dto.AnswerDto;
import com.demo.chatbot.interfaces.request.AbortDialogueRequest;
import com.demo.chatbot.interfaces.request.BeginSessionRequest;
import com.demo.chatbot.interfaces.request.DialogueRequest;
import com.demo.chatbot.interfaces.request.EndSessionRequest;
import com.demo.chatbot.interfaces.response.BaseResponse;
import com.demo.chatbot.interfaces.response.GenericResponse;

public interface ChatbotService {
    /**
     * 开启会话，协议是SSE。
     *
     * @param beginSessionRequest 参数
     * @return 机器人回答，一般是欢迎语文本。
     */
    void beginSession(BeginSessionRequest beginSessionRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback);

    /**
     * 对话接口，协议是SSE。
     *
     * @param dialogueRequest 参数
     * @return 机器人回答
     */
    void dialogue(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback);

    /**
     * 终止当前轮次对话，协议是HTTPS。
     *
     * @param abortDialogueRequest 参数
     * @return 成功或失败
     */
    BaseResponse abortDialogue(AbortDialogueRequest abortDialogueRequest);

    /**
     * 结束会话，协议是HTTPS。
     *
     * @param endSessionRequest 参数
     * @return 成功或失败
     */
    BaseResponse endSession(EndSessionRequest endSessionRequest);
}
