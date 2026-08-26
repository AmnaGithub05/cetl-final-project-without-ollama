# Import the tools we need from PyTorch for building and running neural networks
import torch

# Import torch.nn (neural network layers and modules)
import torch.nn as nn

# Import F (useful functions like softmax)
import torch.nn.functional as F

# Import json (for working with structured data)
import json

# Import Path (for working with file paths)
from pathlib import Path

# Import re (for parsing text with regular expressions)
import re


# ============================================================================
# STEP 1: Define the TinySLM class (same architecture as your Colab model)
# ============================================================================

class TinySLM(nn.Module):
    """
    A tiny Small Language Model using PyTorch.
    This matches the architecture from your Colab notebook.
    """
    
    # Define the hyperparameters (these must match what you trained with)
    vocab_size = 1024      # Total number of different tokens (characters)
    n_emb = 256            # Size of embedding vectors
    n_head = 16            # Number of attention heads
    n_layer = 12           # Number of transformer layers
    block_size = 512       # Maximum sequence length (UPDATED from 128)

    def __init__(self):
        # Call parent class to initialize PyTorch neural network
        super().__init__()
        
        # Embedding layer: converts token ID (number) into a vector of meanings
        self.token_embedding = nn.Embedding(self.vocab_size, self.n_emb)
        
        # Embedding layer: adds position information (where in the sequence)
        self.position_embedding = nn.Embedding(self.block_size, self.n_emb)
        
        # Create a stack of transformer encoder layers (the "brain" of the model)
        self.blocks = nn.Sequential(*[
            nn.TransformerEncoderLayer(
                d_model=self.n_emb,        # Size of vectors flowing through
                nhead=self.n_head,         # Number of attention heads
                batch_first=True           # Batch dimension comes first
            )
            for _ in range(self.n_layer)  # Stack n_layer of these blocks
        ])
        
        # Final layer: converts embeddings to predictions for each token
        self.lm_head = nn.Linear(self.n_emb, self.vocab_size)

    def forward(self, idx, targets=None):
        """
        Forward pass: run data through the model.
        
        Input:
            idx: tensor of token IDs, shape [batch_size, sequence_length]
            targets: (optional) correct answers for training, shape [batch_size, sequence_length]
        
        Output:
            logits: prediction scores for each token, shape [batch_size, sequence_length, vocab_size]
            loss: (optional) the error if targets were provided
        """
        
        # Get dimensions: B = batch size, T = sequence length
        B, T = idx.shape
        
        # Convert token IDs to embedding vectors
        tok_emb = self.token_embedding(idx)
        
        # Create position embeddings (one position vector for each position in sequence)
        pos_emb = self.position_embedding(torch.arange(T, device=idx.device))
        
        # Combine token embeddings with position information
        x = tok_emb + pos_emb
        
        # Pass through all transformer blocks
        x = self.blocks(x)
        
        # Convert to logits (prediction scores for each token in vocabulary)
        logits = self.lm_head(x)
        
        # Calculate loss only if we have targets (for training)
        loss = None
        if targets is not None:
            B, T, C = logits.shape
            loss = F.cross_entropy(logits.view(B*T, C), targets.view(B*T))
        
        # Return predictions and loss
        return logits, loss


# ============================================================================
# STEP 2: Define the TinySLMRunner (inference wrapper)
# ============================================================================

class TinySLMRunner:
    """
    Wrapper class that:
    1. Loads the model from disk
    2. Provides inference functions
    3. Handles tokenization and output parsing
    """
    
    def __init__(self, model_path="./slm_weights.pth", device='cpu'):
        """
        Initialize the runner by loading the model.
        
        Args:
            model_path: path to the saved model weights file
            device: 'cpu' or 'cuda' (GPU)
        """
        
        # Store the model path
        self.model_path = model_path
        
        # Store which device to use (CPU or GPU)
        self.device = device
        
        # Load the model from the checkpoint file
        self.model = self._load_model()
        
        # Set model to evaluation mode (no dropout, etc.)
        self.model.eval()
        
        # Create character-to-ID and ID-to-character mappings (tokenizer)
        self._init_tokenizer()
        
        # Print confirmation
        print(f"✓ TinySLMRunner initialized on {device}")

    def _load_model(self):
        """Load the saved model weights from disk."""
        
        # Create a new TinySLM model (empty, no weights yet)
        model = TinySLM()
        
        # Load the checkpoint file
        checkpoint = torch.load(self.model_path, map_location=self.device)
        
        # Handle two possible checkpoint formats
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            # If checkpoint is a dict with 'model_state_dict' key, use that
            model.load_state_dict(checkpoint['model_state_dict'])
        else:
            # Otherwise, assume checkpoint is the state_dict directly
            model.load_state_dict(checkpoint)
        
        # Move model to the specified device (CPU or GPU)
        model = model.to(self.device)
        
        # Return the loaded model
        return model

    def _init_tokenizer(self):
        """
        Create character-level tokenizer.
        Maps characters ↔ token IDs (0-1023)
        """
        
        # Create mapping from character to ID (0-255 for ASCII, rest empty)
        # We use ord() to get the ASCII value of each character
        self.char_to_idx = {chr(i): i for i in range(256)}
        
        # Create reverse mapping from ID to character
        self.idx_to_char = {i: chr(i) for i in range(256)}
        
        # For tokens 256+, map them to special tokens (for future expansion)
        for i in range(256, 1024):
            self.idx_to_char[i] = f"<TOKEN_{i}>"

    def encode(self, text):
        """
        Convert text string into list of token IDs.
        
        Input: "Hello" 
        Output: [72, 101, 108, 108, 111]  (ASCII values of each character)
        """
        
        # Convert each character to its token ID
        tokens = []
        for char in text:
            if char in self.char_to_idx:
                # Use the character's ID
                tokens.append(self.char_to_idx[char])
            else:
                # If character not in mapping, use ID 0 (unknown token)
                tokens.append(0)
        
        return tokens

    def decode(self, tokens):
        """
        Convert list of token IDs back into text string.
        
        Input: [72, 101, 108, 108, 111]
        Output: "Hello"
        """
        
        # Convert each token ID back to its character
        chars = []
        for token_id in tokens:
            if token_id in self.idx_to_char:
                chars.append(self.idx_to_char[token_id])
            else:
                # If token ID not in mapping, skip it
                pass
        
        return ''.join(chars)

    def generate(self, prompt, max_length=256, temperature=0.7):
        """
        Generate tokens one-by-one until we reach max_length or hit a stopping condition.
        
        Input:
            prompt: starting text (e.g., "Q: What is 2+2? A: 5 -> MISCONCEPTION:")
            max_length: maximum number of tokens to generate
            temperature: controls randomness (0.1 = deterministic, 1.0 = random)
        
        Output:
            Generated text string
        """
        
        # Convert prompt to token IDs
        tokens = self.encode(prompt)
        
        # Keep track of all generated tokens (prompt + generated)
        all_tokens = list(tokens)
        
        # Generate tokens one at a time
        for _ in range(max_length):
            # If we've reached model's max length, stop
            if len(all_tokens) >= self.model.block_size:
                break
            
            # Convert tokens to tensor, add batch dimension
            # Shape: [1, num_tokens]
            token_tensor = torch.tensor([all_tokens], dtype=torch.long, device=self.device)
            
            # Run model (no gradients needed, we're just predicting)
            with torch.no_grad():
                logits, _ = self.model(token_tensor)
            
            # Get logits for the last token (what comes next?)
            # Shape: [vocab_size]
            next_logits = logits[0, -1, :]
            
            # Apply temperature (controls randomness)
            next_logits = next_logits / temperature
            
            # Convert logits to probabilities (softmax)
            probs = F.softmax(next_logits, dim=-1)
            
            # Sample the next token (pick one based on probabilities)
            next_token = torch.multinomial(probs, num_samples=1).item()
            
            # Add the new token to our list
            all_tokens.append(next_token)
            
            # If we generate a common stopping character, stop early
            # (e.g., if model generates newline at end of feedback)
            if next_token == ord('\n'):
                break
        
        # Convert all tokens (prompt + generated) back to text
        generated_text = self.decode(all_tokens)
        
        # Remove the prompt from the output (we only want the generated part)
        generated_part = generated_text[len(prompt):]
        
        return generated_part

    def parse_misconception_output(self, output_text):
        """
        Parse the generated text into structured misconception data.
        
        Expected format:
        CODE: TRAP_1
        SEVERITY: HIGH
        CONFIDENCE: 0.89
        FEEDBACK: The student confused X with Y...
        
        Output:
        {
            "misconception_code": "TRAP_1",
            "severity": "HIGH",
            "confidence_score": 0.89,
            "slm_feedback": "The student confused X with Y..."
        }
        """
        
        # Try to extract CODE
        code_match = re.search(r'CODE:\s*(\w+)', output_text, re.IGNORECASE)
        misconception_code = code_match.group(1) if code_match else "UNKNOWN"
        
        # Try to extract SEVERITY
        severity_match = re.search(r'SEVERITY:\s*(LOW|MEDIUM|HIGH)', output_text, re.IGNORECASE)
        severity = severity_match.group(1).upper() if severity_match else "MEDIUM"
        
        # Try to extract CONFIDENCE
        confidence_match = re.search(r'CONFIDENCE:\s*([\d.]+)', output_text)
        try:
            confidence_score = float(confidence_match.group(1)) if confidence_match else 0.5
            # Clamp between 0 and 1
            confidence_score = max(0.0, min(1.0, confidence_score))
        except ValueError:
            confidence_score = 0.5
        
        # Extract FEEDBACK (everything after "FEEDBACK:")
        feedback_match = re.search(r'FEEDBACK:\s*(.+)', output_text, re.DOTALL)
        slm_feedback = feedback_match.group(1).strip() if feedback_match else output_text
        
        # Return structured data
        return {
            "misconception_code": misconception_code,
            "severity": severity,
            "confidence_score": confidence_score,
            "slm_feedback": slm_feedback
        }

    def predict_misconception(self, question, answer, answer_key=None):
        """
        Detect misconceptions in a student's answer.
        
        This is the main function you'll call from Flask.
        
        Input:
            question: the exam question
            answer: the student's answer (can be a long paragraph)
            answer_key: (optional) the correct/expected answer from the instructor
        
        Output:
            {
                "misconception_code": str,
                "severity": str,
                "confidence_score": float,
                "slm_feedback": str
            }
        """
        
        # Truncate answer to fit in model (block_size - prompt length - buffer)
        max_answer_length = 400
        if len(answer) > max_answer_length:
            answer = answer[:max_answer_length] + "..."
        
        # Build the prompt, including answer key if provided
        if answer_key:
            # Truncate answer key as well
            if len(answer_key) > max_answer_length:
                answer_key = answer_key[:max_answer_length] + "..."
            
            # Format input with answer key for comparison
            prompt = f"Q: {question}\nANSWER_KEY: {answer_key}\nSTUDENT_ANSWER: {answer}\n-> MISCONCEPTION:\n"
        else:
            # Format input without answer key
            prompt = f"Q: {question}\nSTUDENT_ANSWER: {answer}\n-> MISCONCEPTION:\n"
        
        # Generate misconception analysis
        output = self.generate(prompt, max_length=256, temperature=0.7)
        
        # Parse the output into structured data
        result = self.parse_misconception_output(output)
        
        # Add raw output for debugging (optional)
        result["raw_output"] = output
        
        return result


# ============================================================================
# STEP 3: Test the model (run this to make sure everything works)
# ============================================================================

if __name__ == "__main__":
    # Create a runner (loads the model)
    print("Loading model...")
    runner = TinySLMRunner("./slm_weights.pth", device='cpu')
    
    # Test with an example question and answer
    print("\nTesting misconception detection...\n")
    result = runner.predict_misconception(
        question="What is the difference between heat and temperature?",
        answer="Heat and temperature are the same thing. They both measure how hot something is."
    )
    
    # Print the result nicely
    print(json.dumps(result, indent=2))