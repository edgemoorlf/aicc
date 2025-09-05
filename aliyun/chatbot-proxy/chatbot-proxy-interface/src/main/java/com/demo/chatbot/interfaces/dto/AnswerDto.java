package com.demo.chatbot.interfaces.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Builder
@Data
public class AnswerDto {
    /**
     * 流式结束标志位
     */
    @Builder.Default
    private boolean streamEnd = false;
    /**
     * 应答更新时间戳, 单位为毫秒
     */
    private long updatedTime;
    /**
     * 会话ID
     */
    @NotEmpty
    private String sessionId;
    /**
     * 对话轮次ID
     */
    @NotEmpty
    private String streamId;
    /**
     * 机器人回答
     */
    @NotNull
    private String answer;
    /**
     * 机器人发言语音控制参数
     */
    private List<String> controlParamsList;
}
