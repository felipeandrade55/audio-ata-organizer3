import { useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { TranscriptionSegment } from "@/types/transcription";
import { voiceIdentificationService } from "@/services/voiceIdentificationService";
import { playIdentificationPrompt } from "@/services/audioService";
import { processTranscriptionResult } from "@/services/transcriptionService";
import { handleNameRecognition } from "@/services/nameRecognitionService";

export const useRecording = (apiKey: string) => {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionSegments, setTranscriptionSegments] = useState<TranscriptionSegment[]>([]);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);

  const startRecording = useCallback(async (identificationEnabled: boolean) => {
    if (!apiKey) {
      toast({
        title: "Erro",
        description: "Por favor, insira sua chave da API OpenAI primeiro.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (identificationEnabled) {
        voiceIdentificationService.clear();
        await playIdentificationPrompt();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
        } 
      });
      
      const recorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const name = handleNameRecognition(transcript);
          
          if (name && !voiceIdentificationService.profiles.find(p => p.name === name)) {
            voiceIdentificationService.addProfile(name, new Float32Array(0));
            toast({
              title: "Novo participante identificado",
              description: `Identificamos o participante: ${name}`,
            });
          }
        }
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
        
        if (!recordingStartTime || Date.now() - recordingStartTime < 100) {
          toast({
            title: "Aviso",
            description: "A gravação é muito curta. Por favor, grave por mais tempo.",
            variant: "destructive",
          });
          return;
        }

        setIsTranscribing(true);
        
        try {
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.wav');
          formData.append('model', 'whisper-1');
          formData.append('language', 'pt');
          formData.append('response_format', 'verbose_json');

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Falha na transcrição');
          }

          const result = await response.json();
          const segments = processTranscriptionResult(result);
          setTranscriptionSegments(segments);
          
          toast({
            title: "Transcrição concluída",
            description: "A ata da reunião está pronta.",
          });
        } catch (error) {
          console.error('Erro na transcrição:', error);
          toast({
            title: "Erro na transcrição",
            description: error instanceof Error ? error.message : "Não foi possível transcrever o áudio.",
            variant: "destructive",
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(1000);
      setRecordingStartTime(Date.now());
      mediaRecorderRef.current = recorder;
      speechRecognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
      setIsPaused(false);
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível acessar o microfone.",
        variant: "destructive",
      });
    }
  }, [apiKey, toast, recordingStartTime]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsRecording(false);
      setIsPaused(false);
      mediaRecorderRef.current = null;
      speechRecognitionRef.current = null;
      setRecordingStartTime(null);
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsPaused(true);
      toast({
        title: "Gravação pausada",
        description: "A gravação foi pausada. Clique em retomar para continuar.",
      });
    }
  }, [toast]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.start();
      }
      setIsPaused(false);
      toast({
        title: "Gravação retomada",
        description: "A gravação foi retomada.",
      });
    }
  }, [toast]);

  return {
    isRecording,
    isPaused,
    isTranscribing,
    transcriptionSegments,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  };
};