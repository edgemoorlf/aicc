package com.demo.chatbot.interfaces;

import com.demo.chatbot.interfaces.request.AbortDialogueRequest;
import com.demo.chatbot.interfaces.request.BeginSessionRequest;
import com.demo.chatbot.interfaces.request.DialogueRequest;
import com.demo.chatbot.interfaces.request.EndSessionRequest;
import com.demo.chatbot.interfaces.response.BaseResponse;
import com.demo.chatbot.interfaces.response.GenericResponse;
import com.demo.chatbot.interfaces.dto.AnswerDto;

public interface ChatbotService {
    void beginSession(BeginSessionRequest beginSessionRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback);
    void dialogue(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback);
    BaseResponse abortDialogue(AbortDialogueRequest abortDialogueRequest);
    BaseResponse endSession(EndSessionRequest endSessionRequest);
}