package com.demo.chatbot.interfaces.dto;

import com.demo.chatbot.interfaces.constant.ControlType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class HangUpControlParams implements ControlParams {
    /**
     * 延迟挂机，单位是秒，默认值0。
     * <p>
     *     限制：取值范围为0~10。
     * </p>
     */
    @Max(10)
    @Min(0)
    @Builder.Default
    private int delay = 0;
    /**
     * 挂断原因，最好描述清楚，有助于后续数据分析。
     */
    private String reason;

    @Override
    public ControlType getType() {
        return ControlType.HangUp;
    }
}
